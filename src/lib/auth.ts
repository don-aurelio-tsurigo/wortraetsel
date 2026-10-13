import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./types";

type JWKS = ReturnType<typeof createRemoteJWKSet>;
const jwksCache = new Map<string, JWKS>();

type AdminCtx = Context<{ Bindings: Env; Variables: { adminEmail: string } }>;

export const SESSION_COOKIE = "raetsel_admin";
/** Anzeige im Backend-Header beim Passwort-Login (es gibt keine Personen) */
export const ADMIN_LABEL = "Admin";
const SESSION_DAYS = 30;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
/** Obergrenze über alle IPs, gegen verteiltes Durchprobieren */
const MAX_FAILED_LOGINS_GLOBAL = 50;

/**
 * Login fürs Backend, in dieser Reihenfolge:
 * 1. Cloudflare Access (ACCESS_TEAM_DOMAIN + ACCESS_AUD gesetzt): signiertes Access-JWT prüfen
 * 2. ADMIN_PASSWORD gesetzt: Passwort-Login mit signiertem Cookie
 * 3. lokal mit DEV_ADMIN_BYPASS=1: offen
 * Sonst bleibt /admin gesperrt.
 */
export function authMode(env: Env): "access" | "password" | "dev" | "none" {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) return "access";
  if (env.ADMIN_PASSWORD) return "password";
  if (env.DEV_ADMIN_BYPASS === "1") return "dev";
  return "none";
}

export const requireAdmin = createMiddleware<{ Bindings: Env; Variables: { adminEmail: string } }>(
  async (c, next) => {
    const mode = authMode(c.env);
    const path = new URL(c.req.url).pathname;
    if (mode === "password" && (path === "/admin/login" || path === "/admin/logout")) return next();

    if (mode === "dev") {
      c.set("adminEmail", "dev@localhost");
      return next();
    }
    if (mode === "none") {
      return c.text("Backend nicht konfiguriert: ADMIN_PASSWORD fehlt.", 503);
    }
    if (mode === "password") {
      if (await hasValidSession(c)) {
        c.set("adminEmail", ADMIN_LABEL);
        return next();
      }
      if (c.req.method !== "GET") return c.text("Nicht eingeloggt.", 401);
      return c.redirect(`/admin/login?next=${encodeURIComponent(path)}`, 303);
    }
    return verifyAccess(c, next);
  },
);

// ─── Cloudflare Access ──────────────────────────────────────────

async function verifyAccess(c: AdminCtx, next: () => Promise<void>) {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD } = c.env;
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token || !ACCESS_TEAM_DOMAIN || !ACCESS_AUD) return c.text("Kein Zugriff.", 403);

  let jwks = jwksCache.get(ACCESS_TEAM_DOMAIN);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
    jwksCache.set(ACCESS_TEAM_DOMAIN, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://${ACCESS_TEAM_DOMAIN}`,
      audience: ACCESS_AUD,
    });
    c.set("adminEmail", String(payload.email ?? ""));
  } catch {
    return c.text("Kein Zugriff.", 403);
  }
  return next();
}

// ─── Passwort-Login ─────────────────────────────────────────────

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Das Cookie ist mit dem Passwort signiert: ein neues Passwort meldet alle automatisch ab.
async function sign(env: Env, expires: number): Promise<string> {
  return toHex(await hmac(env.ADMIN_PASSWORD!, `raetsel-admin-session:${expires}`));
}

async function hasValidSession(c: AdminCtx): Promise<boolean> {
  const value = getCookie(c, SESSION_COOKIE);
  if (!value) return false;
  const [expiresRaw, signature] = value.split(".");
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now() || !signature) return false;
  const expected = new TextEncoder().encode(await sign(c.env, expires));
  return equalBytes(expected, new TextEncoder().encode(signature));
}

/** Vergleicht über HMAC, damit die Laufzeit nichts über das Passwort verrät. */
export async function checkPassword(env: Env, input: string): Promise<boolean> {
  const salt = "raetsel-password-check";
  const [a, b] = await Promise.all([hmac(salt, input), hmac(salt, env.ADMIN_PASSWORD ?? "")]);
  return !!env.ADMIN_PASSWORD && equalBytes(a, b);
}

export async function startSession(c: AdminCtx) {
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  setCookie(c, SESSION_COOKIE, `${expires}.${await sign(c.env, expires)}`, {
    path: "/admin",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    expires: new Date(expires),
  });
}

export function endSession(c: AdminCtx) {
  deleteCookie(c, SESSION_COOKIE, { path: "/admin" });
}

export function clientIp(c: AdminCtx): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

/** true = zu viele Fehlversuche, Login vorübergehend gesperrt */
export async function isLockedOut(db: D1Database, ip: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT SUM(ip = ?) AS mine, COUNT(*) AS total FROM login_attempts
       WHERE at > datetime('now', ?)`,
    )
    .bind(ip, `-${LOCKOUT_MINUTES} minutes`)
    .first<{ mine: number | null; total: number }>();
  return (row?.mine ?? 0) >= MAX_FAILED_LOGINS || (row?.total ?? 0) >= MAX_FAILED_LOGINS_GLOBAL;
}

export async function recordFailedLogin(db: D1Database, ip: string) {
  await db.batch([
    db.prepare("INSERT INTO login_attempts (ip) VALUES (?)").bind(ip),
    db.prepare("DELETE FROM login_attempts WHERE at < datetime('now', '-1 day')"),
  ]);
}
