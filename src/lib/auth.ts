import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./types";

type JWKS = ReturnType<typeof createRemoteJWKSet>;
const jwksCache = new Map<string, JWKS>();

/**
 * Schützt /admin. In Produktion steht Cloudflare Access vor der Route; zusätzlich
 * prüfen wir hier das signierte Access-JWT, damit /admin nie versehentlich offen ist
 * (z.B. über die workers.dev-URL, die Access nicht abdeckt).
 */
export const requireAdmin = createMiddleware<{ Bindings: Env; Variables: { adminEmail: string } }>(
  async (c, next) => {
    const { ACCESS_TEAM_DOMAIN, ACCESS_AUD, DEV_ADMIN_BYPASS } = c.env;

    if (!ACCESS_TEAM_DOMAIN || !ACCESS_AUD) {
      if (DEV_ADMIN_BYPASS === "1") {
        c.set("adminEmail", "dev@localhost");
        return next();
      }
      return c.text("Backend nicht konfiguriert: ACCESS_TEAM_DOMAIN und ACCESS_AUD fehlen.", 503);
    }

    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) return c.text("Kein Zugriff.", 403);

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
  },
);
