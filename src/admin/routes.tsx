import { Hono } from "hono";
import type { Context } from "hono";
import {
  authMode,
  checkPassword,
  clientIp,
  endSession,
  isLockedOut,
  LOCKOUT_MINUTES,
  recordFailedLogin,
  requireAdmin,
  startSession,
} from "../lib/auth";
import { addDays, formatDateCH, todayZurich } from "../lib/dates";
import { isPuzzleDay, parseWeekdays, projectDates } from "../lib/schedule";
import {
  PUZZLE_TYPES,
  SEGMENTS,
  SLOTS,
  type EntryRow,
  type Env,
  type MessageRow,
  type PauseRow,
  type PaywallMode,
  type PuzzleRow,
  type PuzzleType,
  type Segment,
  type Slot,
} from "../lib/types";
import {
  isInDictionary,
  normalizeColor,
  normalizeUrl,
  splitSolutions,
  validateSlug,
  validateWordleSolution,
  wordLength,
} from "../lib/validation";
import { ConfirmButton, Flash, Layout, PuzzleHeader } from "./ui";

type AppEnv = { Bindings: Env; Variables: { adminEmail: string } };
type Ctx = Context<AppEnv>;

export const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

// ─── Login (nur beim Passwort-Login erreichbar) ─────────────────

function safeNext(value: unknown): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin";
}

admin.get("/login", (c) => {
  if (authMode(c.env) !== "password") return c.redirect("/admin", 303);
  const next = safeNext(c.req.query("next"));
  return c.html(
    <Layout title="Anmelden">
      <div style="max-width: 380px; margin: 40px auto 0">
        <h1>Anmelden</h1>
        <p class="lead">Backend der Newsletter-Rätsel.</p>
        <Flash err={c.req.query("err")} />
        <form class="card" method="post" action="/admin/login">
          <input type="hidden" name="next" value={next} />
          <label>Passwort</label>
          <input type="password" name="password" required autofocus autocomplete="current-password"
            style="width: 100%; padding: 8px 10px; border: 1px solid #cfcbbf; border-radius: 6px; font: inherit" />
          <div class="actions"><button type="submit">Anmelden</button></div>
        </form>
      </div>
    </Layout>,
  );
});

admin.post("/login", async (c) => {
  if (authMode(c.env) !== "password") return c.redirect("/admin", 303);
  const body = await c.req.parseBody();
  const next = safeNext(body.next);
  const ip = clientIp(c);
  const retry = (err: string) =>
    c.redirect(`/admin/login?next=${encodeURIComponent(next)}&err=${encodeURIComponent(err)}`, 303);

  if (await isLockedOut(c.env.DB, ip)) {
    return retry(`Zu viele Fehlversuche. Bitte in ${LOCKOUT_MINUTES} Minuten nochmals versuchen.`);
  }
  if (!(await checkPassword(c.env, String(body.password ?? "")))) {
    await recordFailedLogin(c.env.DB, ip);
    return retry("Falsches Passwort.");
  }
  await startSession(c);
  return c.redirect(next, 303);
});

admin.post("/logout", (c) => {
  endSession(c);
  return c.redirect("/admin/login", 303);
});

const LOW_QUEUE_WARNING = 10;
const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};
const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// ─── Helfer ─────────────────────────────────────────────────────

function back(c: Ctx, path: string, flash: { ok?: string; err?: string } = {}) {
  const params = new URLSearchParams();
  if (flash.ok) params.set("ok", flash.ok);
  if (flash.err) params.set("err", flash.err);
  const qs = params.toString();
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return c.redirect(`${qs ? `${base}${sep}${qs}` : base}${hash ? `#${hash}` : ""}`, 303);
}

function flashFrom(c: Ctx) {
  return { ok: c.req.query("ok"), err: c.req.query("err") };
}

async function loadPuzzle(c: Ctx): Promise<PuzzleRow | null> {
  return c.env.DB.prepare("SELECT * FROM puzzles WHERE id = ?").bind(c.req.param("id")).first<PuzzleRow>();
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function intInRange(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function touch(db: D1Database, id: string) {
  return db.prepare("UPDATE puzzles SET updated_at = datetime('now') WHERE id = ?").bind(id);
}

// ─── Übersicht ──────────────────────────────────────────────────

admin.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*,
       (SELECT COUNT(*) FROM puzzle_entries e WHERE e.puzzle_id = p.id AND e.played_on IS NULL) AS queue
     FROM puzzles p ORDER BY p.name`,
  ).all<PuzzleRow & { queue: number }>();

  return c.html(
    <Layout title="Rätsel" adminEmail={c.get("adminEmail")}>
      <div class="inline" style="justify-content: space-between">
        <h1>Rätsel</h1>
        <a class="btn" href="/admin/new">+ Neues Rätsel</a>
      </div>
      <p class="lead">Alle Newsletter-Rätsel. Jedes läuft unter einer eigenen Adresse.</p>
      <Flash {...flashFrom(c)} />
      <div class="card">
        {results.length === 0 ? (
          <p>Noch keine Rätsel erfasst.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Adresse</th><th>Typ</th><th>Status</th><th>Paywall</th><th>Wörter in Warteschlange</th></tr>
            </thead>
            <tbody>
              {results.map((p) => (
                <tr>
                  <td><a href={`/admin/p/${p.id}/general`}><strong>{p.name}</strong></a></td>
                  <td>/{p.slug}</td>
                  <td>{PUZZLE_TYPES[p.type]?.label ?? p.type}</td>
                  <td><span class={p.active ? "badge on" : "badge"}>{p.active ? "aktiv" : "inaktiv"}</span></td>
                  <td>{paywallLabel(p.paywall_mode)}</td>
                  <td>
                    {p.queue}{" "}
                    {p.queue < LOW_QUEUE_WARNING ? <span class="badge warn">wenig</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>,
  );
});

function paywallLabel(mode: PaywallMode) {
  return { off: "aus", shadow: "Testbetrieb", on: "aktiv" }[mode];
}

// ─── Neues Rätsel ───────────────────────────────────────────────

admin.get("/new", (c) =>
  c.html(
    <Layout title="Neues Rätsel" adminEmail={c.get("adminEmail")}>
      <h1>Neues Rätsel</h1>
      <p class="lead">Alles Weitere (Logo, Texte, Wörter) erfasst du im nächsten Schritt.</p>
      <Flash {...flashFrom(c)} />
      <form class="card" method="post" action="/admin/new">
        <label>Name <span class="hint">z.B. «6iBrief Worträtsel»</span></label>
        <input type="text" name="name" required />
        <label>Slug <span class="hint">Teil der Adresse, z.B. «6ibrief» → /6ibrief</span></label>
        <input type="text" name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,39}" />
        <label>Spieltyp</label>
        <select name="type">
          {Object.entries(PUZZLE_TYPES).map(([id, t]) => <option value={id}>{t.label}</option>)}
        </select>
        <div class="actions"><button type="submit">Anlegen</button><a class="btn secondary" href="/admin">Abbrechen</a></div>
      </form>
    </Layout>,
  ),
);

admin.post("/new", async (c) => {
  const body = await c.req.parseBody();
  const name = str(body.name);
  const slug = str(body.slug).toLowerCase();
  const type = str(body.type) as PuzzleType;
  if (!name) return back(c, "/admin/new", { err: "Name fehlt." });
  const slugError = validateSlug(slug);
  if (slugError) return back(c, "/admin/new", { err: slugError });
  if (!PUZZLE_TYPES[type]) return back(c, "/admin/new", { err: "Unbekannter Spieltyp." });

  const exists = await c.env.DB.prepare("SELECT 1 FROM puzzles WHERE slug = ?").bind(slug).first();
  if (exists) return back(c, "/admin/new", { err: `Der Slug «${slug}» ist schon vergeben.` });

  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO puzzles (id, slug, name, type, settings) VALUES (?, ?, ?, ?, ?)")
    .bind(id, slug, name, type, JSON.stringify(PUZZLE_TYPES[type].defaultSettings))
    .run();
  return back(c, `/admin/p/${id}/general`, { ok: "Rätsel angelegt. Es ist noch inaktiv." });
});

admin.get("/p/:id", (c) => c.redirect(`/admin/p/${c.req.param("id")}/general`));

// ─── Tab: Allgemein ─────────────────────────────────────────────

admin.get("/p/:id/general", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const { results: pauses } = await c.env.DB.prepare(
    "SELECT * FROM puzzle_pauses WHERE puzzle_id = ? ORDER BY start_date",
  ).bind(puzzle.id).all<PauseRow>();
  const weekdays = parseWeekdays(puzzle);
  const origin = new URL(c.req.url).origin;
  const mailchimpLink = `${origin}/${puzzle.slug}?id=*|MMERGE3|**|UNIQID|*`;
  const today = todayZurich();

  return c.html(
    <Layout title={puzzle.name} adminEmail={c.get("adminEmail")}>
      <PuzzleHeader puzzle={puzzle} tab="general" />
      <Flash {...flashFrom(c)} />

      <form class="card" method="post" action={`/admin/p/${puzzle.id}/general`} enctype="multipart/form-data">
        <div class="row">
          <div>
            <label>Name</label>
            <input type="text" name="name" value={puzzle.name} required />
          </div>
          <div>
            <label>Slug <span class="hint">Adresse /{puzzle.slug}. Achtung: ändert den Newsletter-Link.</span></label>
            <input type="text" name="slug" value={puzzle.slug} required pattern="[a-z0-9][a-z0-9\-]{1,39}" />
          </div>
        </div>
        <div class="row">
          <div>
            <label>Spieltyp</label>
            <select name="type">
              {Object.entries(PUZZLE_TYPES).map(([id, t]) => (
                <option value={id} selected={id === puzzle.type}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Akzentfarbe <span class="hint">Buttons und Hervorhebungen im Spiel</span></label>
            <input type="color" name="accent_color" value={puzzle.accent_color ?? "#1a1a1b"} />
          </div>
        </div>

        <label>Text beim Teilen <span class="hint">wird unter das Ergebnis gehängt, z.B. «6iBrief abonnieren und mitspielen: 6iBrief.ch/abonnieren»</span></label>
        <input type="text" name="share_text" value={puzzle.share_text ?? ""} />

        <label>Logo <span class="hint">PNG, JPG, SVG oder WebP, max. 1 MB</span></label>
        {puzzle.logo_key ? (
          <img class="logo-preview" src={`/${puzzle.slug}/logo?v=${encodeURIComponent(puzzle.logo_key)}`} alt="Logo" />
        ) : (
          <p class="hint">Noch kein Logo.</p>
        )}
        <input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" />
        {puzzle.logo_key ? (
          <label class="check"><input type="checkbox" name="remove_logo" value="1" /> Logo entfernen</label>
        ) : null}

        <label>Neues Wort an diesen Tagen <span class="hint">An anderen Tagen bleibt das letzte Wort aktiv.</span></label>
        <div>
          {WEEKDAY_LABELS.map((l, i) => (
            <label class="check">
              <input type="checkbox" name="weekdays" value={String(i + 1)} checked={weekdays.includes(i + 1)} /> {l}
            </label>
          ))}
        </div>

        <label class="check" style="margin-top: 16px">
          <input type="checkbox" name="active" value="1" checked={!!puzzle.active} /> <strong>Rätsel aktiv</strong>
          <span class="hint">(inaktive Rätsel sind öffentlich nicht erreichbar)</span>
        </label>

        <div class="actions"><button type="submit">Speichern</button></div>
      </form>

      <div class="card">
        <h2 style="margin-top: 0">Link für Mailchimp</h2>
        <p class="hint">
          In den Newsletter einfügen. Mailchimp ersetzt die Platzhalter pro Empfänger:in
          (MMERGE3 = Memberstatus, UNIQID = persönliche ID).
        </p>
        <div class="snippet">
          <input type="text" id="mc-link" value={mailchimpLink} readonly />
          <button type="button" class="secondary"
            onclick="navigator.clipboard.writeText(document.getElementById('mc-link').value);this.textContent='Kopiert ✓'">
            Kopieren
          </button>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top: 0">Pausen</h2>
        <p class="hint">In diesem Zeitraum kommt kein neues Wort, z.B. Sommerpause.</p>
        {pauses.length ? (
          <table>
            <tbody>
              {pauses.map((p) => (
                <tr>
                  <td>{formatDateCH(p.start_date)} – {formatDateCH(p.end_date)}</td>
                  <td>{p.label ?? ""}</td>
                  <td>{p.end_date < today ? <span class="badge">vorbei</span> : null}</td>
                  <td style="text-align: right">
                    <ConfirmButton action={`/admin/p/${puzzle.id}/pauses/${p.id}/delete`} label="Löschen" confirm="Pause löschen?" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <form method="post" action={`/admin/p/${puzzle.id}/pauses`}>
          <div class="row">
            <div><label>Von</label><input type="date" name="start_date" required /></div>
            <div><label>Bis</label><input type="date" name="end_date" required /></div>
            <div><label>Bezeichnung <span class="hint">optional</span></label><input type="text" name="label" placeholder="Sommerpause" /></div>
          </div>
          <div class="actions"><button type="submit" class="secondary">Pause hinzufügen</button></div>
        </form>
      </div>

      <div class="card danger-zone">
        <h2 style="margin-top: 0">Rätsel löschen</h2>
        <p class="hint">Löscht das Rätsel mit allen Texten, Wörtern und Pausen endgültig.</p>
        <ConfirmButton action={`/admin/p/${puzzle.id}/delete`} label="Rätsel endgültig löschen"
          confirm={`«${puzzle.name}» mit allen Texten und Wörtern endgültig löschen?`} class="danger" />
      </div>
    </Layout>,
  );
});

admin.post("/p/:id/general", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const path = `/admin/p/${puzzle.id}/general`;
  const body = await c.req.parseBody({ all: true });

  const name = str(body.name);
  const slug = str(body.slug).toLowerCase();
  const type = str(body.type) as PuzzleType;
  if (!name) return back(c, path, { err: "Name fehlt." });
  const slugError = validateSlug(slug);
  if (slugError) return back(c, path, { err: slugError });
  if (!PUZZLE_TYPES[type]) return back(c, path, { err: "Unbekannter Spieltyp." });
  if (slug !== puzzle.slug) {
    const taken = await c.env.DB.prepare("SELECT 1 FROM puzzles WHERE slug = ? AND id != ?").bind(slug, puzzle.id).first();
    if (taken) return back(c, path, { err: `Der Slug «${slug}» ist schon vergeben.` });
  }

  const rawDays = ([] as unknown[]).concat(body.weekdays ?? []);
  const weekdays = [...new Set(rawDays.map(Number).filter((d) => d >= 1 && d <= 7))].sort();

  let logoKey = puzzle.logo_key;
  const logo = body.logo;
  if (logo instanceof File && logo.size > 0) {
    const ext = LOGO_TYPES[logo.type];
    if (!ext) return back(c, path, { err: "Logo: nur PNG, JPG, SVG oder WebP." });
    if (logo.size > MAX_LOGO_BYTES) return back(c, path, { err: "Logo ist grösser als 1 MB." });
    logoKey = `logos/${puzzle.id}-${Date.now()}.${ext}`;
    await c.env.FILES.put(logoKey, await logo.arrayBuffer(), { httpMetadata: { contentType: logo.type } });
  } else if (body.remove_logo === "1") {
    logoKey = null;
  }
  if (puzzle.logo_key && logoKey !== puzzle.logo_key) await c.env.FILES.delete(puzzle.logo_key);

  await c.env.DB.prepare(
    `UPDATE puzzles SET name = ?, slug = ?, type = ?, accent_color = ?, logo_key = ?, weekdays = ?, active = ?,
       share_text = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(name, slug, type, normalizeColor(body.accent_color), logoKey, JSON.stringify(weekdays),
      body.active === "1" ? 1 : 0, str(body.share_text) || null, puzzle.id)
    .run();

  const warn = weekdays.length === 0 ? " Achtung: keine Wochentage gewählt – es kommen keine neuen Wörter." : "";
  return back(c, path, { ok: `Gespeichert.${warn}` });
});

admin.post("/p/:id/pauses", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const path = `/admin/p/${puzzle.id}/general`;
  const body = await c.req.parseBody();
  const start = str(body.start_date);
  const end = str(body.end_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return back(c, path, { err: "Bitte Start- und Enddatum angeben." });
  }
  if (end < start) return back(c, path, { err: "Das Enddatum liegt vor dem Startdatum." });
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO puzzle_pauses (id, puzzle_id, start_date, end_date, label) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), puzzle.id, start, end, str(body.label) || null),
    touch(c.env.DB, puzzle.id),
  ]);
  return back(c, path, { ok: "Pause hinzugefügt." });
});

admin.post("/p/:id/pauses/:pauseId/delete", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM puzzle_pauses WHERE id = ? AND puzzle_id = ?").bind(c.req.param("pauseId"), id).run();
  return back(c, `/admin/p/${id}/general`, { ok: "Pause gelöscht." });
});

admin.post("/p/:id/delete", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  if (puzzle.logo_key) await c.env.FILES.delete(puzzle.logo_key);
  await c.env.DB.prepare("DELETE FROM puzzles WHERE id = ?").bind(puzzle.id).run();
  return back(c, "/admin", { ok: `«${puzzle.name}» gelöscht.` });
});

// ─── Tab: Zugang ────────────────────────────────────────────────

admin.get("/p/:id/access", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const modes: [PaywallMode, string, string][] = [
    ["off", "Aus", "Alle spielen unbegrenzt. Nicht-Members sehen trotzdem ihre CTAs."],
    ["shadow", "Testbetrieb", "Spiele werden gezählt, aber niemand wird gesperrt. Zum Abschätzen vor dem Start."],
    ["on", "Aktiv", "Nach dem Trial sehen Nicht-Members und Ehemalige die Paywall."],
  ];
  return c.html(
    <Layout title={puzzle.name} adminEmail={c.get("adminEmail")}>
      <PuzzleHeader puzzle={puzzle} tab="access" />
      <Flash {...flashFrom(c)} />
      <form class="card" method="post" action={`/admin/p/${puzzle.id}/access`}>
        <h2 style="margin-top: 0">Paywall</h2>
        {modes.map(([id, label, hint]) => (
          <label class="check" style="display: flex; margin: 8px 0">
            <input type="radio" name="paywall_mode" value={id} checked={puzzle.paywall_mode === id} />
            <span><strong>{label}</strong> <span class="hint">– {hint}</span></span>
          </label>
        ))}

        <div class="row">
          <div>
            <label>Gratis-Spiele (Trial) <span class="hint">für Nicht-Members und Ehemalige</span></label>
            <input type="number" name="trial_limit" min="0" max="1000" value={String(puzzle.trial_limit)} required />
          </div>
          <div>
            <label>Gratis-Rätsel pro Woche <span class="hint">nach Ablauf des Trials</span></label>
            <input type="number" name="weekly_free" min="0" max="7" value={String(puzzle.weekly_free)} required />
          </div>
        </div>

        <h2>Links</h2>
        <p class="hint">
          Standard-Ziele für Buttons. Einzelne Texte unter «Texte & CTAs» können eigene Links haben.
        </p>
        <label>Membership-Link <span class="hint">für Nicht-Members</span></label>
        <input type="url" name="membership_url" value={puzzle.membership_url ?? ""} placeholder="https://mitmachen.tsri.ch" />
        <label>Rückhol-Link <span class="hint">für ehemalige Members; leer = Membership-Link</span></label>
        <input type="url" name="winback_url" value={puzzle.winback_url ?? ""} placeholder="https://…" />

        <div class="actions"><button type="submit">Speichern</button></div>
      </form>
    </Layout>,
  );
});

admin.post("/p/:id/access", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const path = `/admin/p/${puzzle.id}/access`;
  const body = await c.req.parseBody();
  const mode = str(body.paywall_mode) as PaywallMode;
  if (!["off", "shadow", "on"].includes(mode)) return back(c, path, { err: "Ungültiger Paywall-Modus." });
  const trial = intInRange(body.trial_limit, 0, 1000);
  const weekly = intInRange(body.weekly_free, 0, 7);
  if (trial === null || weekly === null) return back(c, path, { err: "Bitte gültige Zahlen angeben." });
  const membership = normalizeUrl(body.membership_url);
  const winback = normalizeUrl(body.winback_url);
  const urlError = membership.error ?? winback.error;
  if (urlError) return back(c, path, { err: urlError });
  if (mode === "on" && !membership.url) {
    return back(c, path, { err: "Für eine aktive Paywall braucht es einen Membership-Link." });
  }

  await c.env.DB.prepare(
    `UPDATE puzzles SET paywall_mode = ?, trial_limit = ?, weekly_free = ?, membership_url = ?, winback_url = ?,
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(mode, trial, weekly, membership.url, winback.url, puzzle.id).run();
  return back(c, path, { ok: "Gespeichert." });
});

// ─── Tab: Texte & CTAs ──────────────────────────────────────────

function slotsFor(segment: Segment) {
  return SLOTS.filter((s) => !(segment === "member" && s.memberOnlyHidden));
}

const MessageFields = ({ slot, msg }: { slot: (typeof SLOTS)[number]; msg?: MessageRow }) => (
  <>
    {slot.title ? (
      <>
        <label>Titel</label>
        <input type="text" name="title" value={msg?.title ?? ""} />
      </>
    ) : null}
    <label>Text</label>
    {slot.id === "win_title"
      ? <input type="text" name="text" value={msg?.text ?? ""} required />
      : <textarea name="text" required>{msg?.text ?? ""}</textarea>}
    {slot.button ? (
      <div class="row">
        <div>
          <label>Button-Text <span class="hint">optional</span></label>
          <input type="text" name="button_text" value={msg?.button_text ?? ""} />
        </div>
        <div>
          <label>Button-Link <span class="hint">leer = Standard-Link aus «Zugang»</span></label>
          <input type="url" name="button_url" value={msg?.button_url ?? ""} placeholder="https://…" />
        </div>
      </div>
    ) : null}
  </>
);

admin.get("/p/:id/texts", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const segment = (SEGMENTS.find((s) => s.id === c.req.query("segment"))?.id ?? "all") as Segment;
  const segmentInfo = SEGMENTS.find((s) => s.id === segment)!;
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM puzzle_messages WHERE puzzle_id = ? AND segment = ? ORDER BY sort_order, created_at",
  ).bind(puzzle.id, segment).all<MessageRow>();
  const base = `/admin/p/${puzzle.id}/texts`;

  return c.html(
    <Layout title={puzzle.name} adminEmail={c.get("adminEmail")}>
      <PuzzleHeader puzzle={puzzle} tab="texts" />
      <Flash {...flashFrom(c)} />
      <nav class="subtabs">
        {SEGMENTS.map((s) => (
          <a href={`${base}?segment=${s.id}`} class={s.id === segment ? "active" : ""}>{s.label}</a>
        ))}
      </nav>
      <p class="hint">{segmentInfo.hint}</p>

      {slotsFor(segment).map((slot) => {
        const msgs = results.filter((m) => m.slot === slot.id);
        return (
          <div class="card" id={slot.id}>
            <h2 style="margin-top: 0">{slot.label} <span class="badge">{msgs.length}</span></h2>
            <p class="hint">{slot.hint}</p>
            {msgs.map((m) => (
              <div class={m.active ? "msg" : "msg inactive"}>
                <div class="body">
                  {m.title ? <strong>{m.title}<br /></strong> : null}
                  {m.text}
                  {m.button_text ? (
                    <div class="meta">Button: «{m.button_text}» → {m.button_url ?? "Standard-Link"}</div>
                  ) : null}
                </div>
                <div class="inline" style="align-items: flex-start">
                  <a class="btn secondary" style="padding: 3px 9px; font-size: 13px" href={`${base}/${m.id}`}>Bearbeiten</a>
                  <form method="post" action={`${base}/${m.id}/toggle`}>
                    <button class="small secondary" type="submit">{m.active ? "Deaktivieren" : "Aktivieren"}</button>
                  </form>
                  <ConfirmButton action={`${base}/${m.id}/delete`} label="Löschen" confirm="Text löschen?" />
                </div>
              </div>
            ))}
            <details>
              <summary>+ Hinzufügen</summary>
              <form method="post" action={base}>
                <input type="hidden" name="segment" value={segment} />
                <input type="hidden" name="slot" value={slot.id} />
                <MessageFields slot={slot} />
                <div class="actions"><button type="submit">Hinzufügen</button></div>
              </form>
            </details>
          </div>
        );
      })}
    </Layout>,
  );
});

function readMessageForm(body: Record<string, unknown>, slot: (typeof SLOTS)[number]) {
  const text = str(body.text);
  if (!text) return { error: "Text fehlt." } as const;
  const buttonText = slot.button ? str(body.button_text) || null : null;
  const url = slot.button ? normalizeUrl(body.button_url) : { url: null };
  if (url.error) return { error: url.error } as const;
  return {
    title: slot.title ? str(body.title) || null : null,
    text,
    buttonText,
    buttonUrl: url.url,
  } as const;
}

admin.post("/p/:id/texts", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const body = await c.req.parseBody();
  const segment = str(body.segment) as Segment;
  const slot = SLOTS.find((s) => s.id === str(body.slot));
  if (!SEGMENTS.some((s) => s.id === segment) || !slot) return c.text("Ungültige Eingabe.", 400);
  const path = `/admin/p/${puzzle.id}/texts?segment=${segment}#${slot.id}`;
  const form = readMessageForm(body, slot);
  if ("error" in form) return back(c, path, { err: form.error });

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO puzzle_messages (id, puzzle_id, segment, slot, title, text, button_text, button_url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?,
         (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM puzzle_messages WHERE puzzle_id = ? AND segment = ? AND slot = ?))`,
    ).bind(crypto.randomUUID(), puzzle.id, segment, slot.id, form.title, form.text, form.buttonText, form.buttonUrl,
      puzzle.id, segment, slot.id),
    touch(c.env.DB, puzzle.id),
  ]);
  return back(c, path, { ok: "Text hinzugefügt." });
});

async function loadMessage(c: Ctx) {
  return c.env.DB.prepare("SELECT * FROM puzzle_messages WHERE id = ? AND puzzle_id = ?")
    .bind(c.req.param("msgId"), c.req.param("id"))
    .first<MessageRow>();
}

admin.get("/p/:id/texts/:msgId", async (c) => {
  const puzzle = await loadPuzzle(c);
  const msg = await loadMessage(c);
  if (!puzzle || !msg) return c.notFound();
  const slot = SLOTS.find((s) => s.id === msg.slot)!;
  const segmentLabel = SEGMENTS.find((s) => s.id === msg.segment)!.label;
  const listPath = `/admin/p/${puzzle.id}/texts?segment=${msg.segment}#${msg.slot}`;
  return c.html(
    <Layout title={puzzle.name} adminEmail={c.get("adminEmail")}>
      <PuzzleHeader puzzle={puzzle} tab="texts" />
      <Flash {...flashFrom(c)} />
      <form class="card" method="post" action={`/admin/p/${puzzle.id}/texts/${msg.id}`}>
        <h2 style="margin-top: 0">{slot.label} · {segmentLabel}</h2>
        <p class="hint">{slot.hint}</p>
        <MessageFields slot={slot} msg={msg} />
        <label>Gruppe <span class="hint">Text in eine andere Gruppe verschieben</span></label>
        <select name="segment">
          {SEGMENTS.filter((s) => !(s.id === "member" && slot.memberOnlyHidden)).map((s) => (
            <option value={s.id} selected={s.id === msg.segment}>{s.label}</option>
          ))}
        </select>
        <div class="actions">
          <button type="submit">Speichern</button>
          <a class="btn secondary" href={listPath}>Abbrechen</a>
        </div>
      </form>
    </Layout>,
  );
});

admin.post("/p/:id/texts/:msgId", async (c) => {
  const msg = await loadMessage(c);
  if (!msg) return c.notFound();
  const slot = SLOTS.find((s) => s.id === msg.slot)!;
  const body = await c.req.parseBody();
  const segment = (SEGMENTS.find((s) => s.id === str(body.segment))?.id ?? msg.segment) as Segment;
  if (segment === "member" && slot.memberOnlyHidden) return c.text("Ungültige Gruppe.", 400);
  const form = readMessageForm(body, slot);
  if ("error" in form) return back(c, `/admin/p/${msg.puzzle_id}/texts/${msg.id}`, { err: form.error });

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE puzzle_messages SET segment = ?, title = ?, text = ?, button_text = ?, button_url = ?,
         updated_at = datetime('now') WHERE id = ?`,
    ).bind(segment, form.title, form.text, form.buttonText, form.buttonUrl, msg.id),
    touch(c.env.DB, msg.puzzle_id),
  ]);
  return back(c, `/admin/p/${msg.puzzle_id}/texts?segment=${segment}#${msg.slot}`, { ok: "Gespeichert." });
});

admin.post("/p/:id/texts/:msgId/toggle", async (c) => {
  const msg = await loadMessage(c);
  if (!msg) return c.notFound();
  await c.env.DB.prepare("UPDATE puzzle_messages SET active = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(msg.active ? 0 : 1, msg.id).run();
  return back(c, `/admin/p/${msg.puzzle_id}/texts?segment=${msg.segment}#${msg.slot}`, {
    ok: msg.active ? "Deaktiviert." : "Aktiviert.",
  });
});

admin.post("/p/:id/texts/:msgId/delete", async (c) => {
  const msg = await loadMessage(c);
  if (!msg) return c.notFound();
  await c.env.DB.prepare("DELETE FROM puzzle_messages WHERE id = ?").bind(msg.id).run();
  return back(c, `/admin/p/${msg.puzzle_id}/texts?segment=${msg.segment}#${msg.slot}`, { ok: "Gelöscht." });
});

// ─── Tab: Wörter ────────────────────────────────────────────────

admin.get("/p/:id/words", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const today = todayZurich();
  const [upcomingRes, playedRes, pausesRes] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM puzzle_entries WHERE puzzle_id = ? AND played_on IS NULL ORDER BY position").bind(puzzle.id),
    c.env.DB.prepare("SELECT * FROM puzzle_entries WHERE puzzle_id = ? AND played_on IS NOT NULL ORDER BY played_on DESC LIMIT 60").bind(puzzle.id),
    c.env.DB.prepare("SELECT * FROM puzzle_pauses WHERE puzzle_id = ?").bind(puzzle.id),
  ]);
  const upcoming = upcomingRes.results as EntryRow[];
  const played = playedRes.results as EntryRow[];
  const pauses = pausesRes.results as PauseRow[];
  const weekdays = parseWeekdays(puzzle);
  const todayEntry = played.find((e) => e.played_on === today);
  const isPuzzleToday = isPuzzleDay(today, weekdays, pauses);
  const dates = projectDates(upcoming.length, today, !!todayEntry, weekdays, pauses);
  const lastPlayed = played.find((e) => e.played_on! < today);
  const len = wordLength(puzzle);
  const base = `/admin/p/${puzzle.id}/words`;

  let todayText: string;
  if (todayEntry) todayText = `${todayEntry.solution} (seit heute aktiv)`;
  else if (isPuzzleToday && upcoming[0]) todayText = `${upcoming[0].solution} (wird beim ersten Aufruf heute aktiv)`;
  else if (lastPlayed) todayText = `${lastPlayed.solution} (vom ${formatDateCH(lastPlayed.played_on!)}, heute kein neues Wort)`;
  else todayText = "– noch keines";

  return c.html(
    <Layout title={puzzle.name} adminEmail={c.get("adminEmail")}>
      <PuzzleHeader puzzle={puzzle} tab="words" />
      <Flash {...flashFrom(c)} />
      {upcoming.length < LOW_QUEUE_WARNING ? (
        <div class="flash warn">
          Nur noch {upcoming.length} {upcoming.length === 1 ? "Wort" : "Wörter"} in der Warteschlange.
          {dates.length ? ` Reicht bis ${formatDateCH(dates[dates.length - 1])}.` : ""} Ist sie leer, bleibt das letzte Wort aktiv.
        </div>
      ) : null}

      <div class="card">
        <div class="stats">
          <div><strong class="mono">{todayText}</strong><span>Heute</span></div>
          <div><strong>{upcoming.length}</strong><span>in der Warteschlange</span></div>
          <div><strong>{dates.length ? formatDateCH(dates[dates.length - 1]) : "–"}</strong><span>reicht bis</span></div>
        </div>
      </div>

      <form class="card" method="post" action={base}>
        <h2 style="margin-top: 0">Wörter hinzufügen</h2>
        <p class="hint">
          Mehrere auf einmal: eines pro Zeile oder mit Komma getrennt. Genau {len} Buchstaben A–Z, ohne Umlaute.
          Neue Wörter kommen ans Ende der Warteschlange.
        </p>
        <textarea name="solutions" placeholder={"APFEL\nSTERN\nWOLKE"} required></textarea>
        <div class="actions"><button type="submit">Hinzufügen</button></div>
      </form>

      <div class="card">
        <h2 style="margin-top: 0">Warteschlange</h2>
        {upcoming.length === 0 ? <p>Leer.</p> : (
          <table>
            <thead><tr><th>#</th><th>Wort</th><th>voraussichtlich</th><th></th><th></th></tr></thead>
            <tbody>
              {upcoming.map((e, i) => (
                <tr>
                  <td class="num">{i + 1}</td>
                  <td class="mono"><strong>{e.solution}</strong></td>
                  <td>{dates[i] ? formatDateCH(dates[i]) : "–"}</td>
                  <td>
                    {puzzle.type === "wordle" && !isInDictionary(e.solution)
                      ? <span class="badge warn" title="Nicht in der Wortliste. Das Spiel akzeptiert es trotzdem als Lösung.">nicht in Wortliste</span>
                      : null}
                  </td>
                  <td style="text-align: right; white-space: nowrap">
                    <form method="post" action={`${base}/${e.id}/move`} style="display: inline">
                      <button class="small secondary" name="dir" value="top" disabled={i === 0} title="An den Anfang">⤒</button>{" "}
                      <button class="small secondary" name="dir" value="up" disabled={i === 0} title="Nach oben">↑</button>{" "}
                      <button class="small secondary" name="dir" value="down" disabled={i === upcoming.length - 1} title="Nach unten">↓</button>
                    </form>{" "}
                    <span style="display: inline-block">
                      <ConfirmButton action={`${base}/${e.id}/delete`} label="✕" confirm={`${e.solution} entfernen?`} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div class="card">
        <h2 style="margin-top: 0">Bereits gespielt</h2>
        <p class="hint">Gespielte Wörter sind fix und können nicht mehr geändert werden.</p>
        {played.length === 0 ? <p>Noch keine.</p> : (
          <table>
            <tbody>
              {played.map((e) => (
                <tr><td style="width: 160px">{formatDateCH(e.played_on!)}</td><td class="mono">{e.solution}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>,
  );
});

admin.post("/p/:id/words", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const path = `/admin/p/${puzzle.id}/words`;
  const body = await c.req.parseBody();
  const words = splitSolutions(str(body.solutions));
  if (words.length === 0) return back(c, path, { err: "Keine Wörter eingegeben." });

  const len = wordLength(puzzle);
  const errors = words.map((w) => validateWordleSolution(w, len)).filter(Boolean);
  if (errors.length) return back(c, path, { err: `Nichts hinzugefügt. ${errors.join(" ")}` });

  const { results: existing } = await c.env.DB.prepare(
    "SELECT solution, played_on FROM puzzle_entries WHERE puzzle_id = ?",
  ).bind(puzzle.id).all<{ solution: string; played_on: string | null }>();
  const queued = new Set(existing.filter((e) => !e.played_on).map((e) => e.solution));
  const playedBefore = new Set(existing.filter((e) => e.played_on).map((e) => e.solution));

  const unique = [...new Set(words)];
  const toAdd = unique.filter((w) => !queued.has(w));
  const skipped = unique.filter((w) => queued.has(w));
  if (toAdd.length === 0) return back(c, path, { err: "Alle Wörter sind schon in der Warteschlange." });

  const max = await c.env.DB.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM puzzle_entries WHERE puzzle_id = ?")
    .bind(puzzle.id).first<{ m: number }>();
  let pos = max?.m ?? 0;
  await c.env.DB.batch([
    ...toAdd.map((w) =>
      c.env.DB.prepare("INSERT INTO puzzle_entries (id, puzzle_id, solution, position) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), puzzle.id, w, ++pos),
    ),
    touch(c.env.DB, puzzle.id),
  ]);

  const notes: string[] = [];
  if (skipped.length) notes.push(`Schon in der Warteschlange, übersprungen: ${skipped.join(", ")}.`);
  const repeats = toAdd.filter((w) => playedBefore.has(w));
  if (repeats.length) notes.push(`Wurden früher schon gespielt: ${repeats.join(", ")}.`);
  const unknown = puzzle.type === "wordle" ? toAdd.filter((w) => !isInDictionary(w)) : [];
  if (unknown.length) notes.push(`Nicht in der Wortliste (funktioniert trotzdem): ${unknown.join(", ")}.`);
  return back(c, path, { ok: `${toAdd.length} ${toAdd.length === 1 ? "Wort" : "Wörter"} hinzugefügt. ${notes.join(" ")}`.trim() });
});

admin.post("/p/:id/words/:entryId/move", async (c) => {
  const puzzleId = c.req.param("id");
  const path = `/admin/p/${puzzleId}/words`;
  const dir = str((await c.req.parseBody()).dir);
  const { results } = await c.env.DB.prepare(
    "SELECT id, position FROM puzzle_entries WHERE puzzle_id = ? AND played_on IS NULL ORDER BY position",
  ).bind(puzzleId).all<{ id: string; position: number }>();
  const idx = results.findIndex((e) => e.id === c.req.param("entryId"));
  if (idx === -1) return back(c, path, { err: "Wort nicht gefunden oder schon gespielt." });

  const order = results.map((e) => e.id);
  const [moved] = order.splice(idx, 1);
  const target = dir === "top" ? 0 : dir === "up" ? Math.max(0, idx - 1) : Math.min(order.length, idx + 1);
  order.splice(target, 0, moved);

  // Bestehende Positionswerte in neuer Reihenfolge wiederverwenden: bleibt hinter gespielten Wörtern
  const positions = results.map((e) => e.position);
  await c.env.DB.batch(
    order.map((id, i) =>
      c.env.DB.prepare("UPDATE puzzle_entries SET position = ? WHERE id = ? AND played_on IS NULL").bind(positions[i], id),
    ),
  );
  return back(c, path);
});

admin.post("/p/:id/words/:entryId/delete", async (c) => {
  const puzzleId = c.req.param("id");
  const res = await c.env.DB.prepare("DELETE FROM puzzle_entries WHERE id = ? AND puzzle_id = ? AND played_on IS NULL")
    .bind(c.req.param("entryId"), puzzleId).run();
  return back(c, `/admin/p/${puzzleId}/words`, res.meta.changes
    ? { ok: "Wort entfernt." }
    : { err: "Gespielte Wörter können nicht entfernt werden." });
});

// ─── Tab: Statistik ─────────────────────────────────────────────

interface DayStats {
  date: string;
  plays: number;
  finished: number;
  won: number;
  avg_attempts: number | null;
  avg_time: number | null;
  member: number;
  nonmember: number;
  former: number;
  anon: number;
}

admin.get("/p/:id/stats", async (c) => {
  const puzzle = await loadPuzzle(c);
  if (!puzzle) return c.notFound();
  const days = [7, 30, 90].includes(Number(c.req.query("days"))) ? Number(c.req.query("days")) : 30;
  const since = addDays(todayZurich(), -(days - 1));
  const db = c.env.DB;

  const [dayRes, paywallRes, playersRes, conversionRes] = await db.batch([
    db.prepare(
      `SELECT date, COUNT(*) AS plays,
         SUM(won IS NOT NULL) AS finished, SUM(won = 1) AS won,
         ROUND(AVG(CASE WHEN won = 1 THEN attempts END), 2) AS avg_attempts,
         ROUND(AVG(CASE WHEN won = 1 THEN time_seconds END)) AS avg_time,
         SUM(segment = 'member') AS member, SUM(segment = 'nonmember') AS nonmember,
         SUM(segment = 'former') AS former, SUM(segment = 'anon') AS anon
       FROM plays WHERE puzzle_id = ? AND date >= ? GROUP BY date ORDER BY date DESC`,
    ).bind(puzzle.id, since),
    db.prepare(
      `SELECT date, SUM(shadow = 0) AS real, SUM(shadow = 1) AS shadow
       FROM paywall_views WHERE puzzle_id = ? AND date >= ? GROUP BY date`,
    ).bind(puzzle.id, since),
    db.prepare(
      `SELECT segment, COUNT(DISTINCT uid) AS n FROM plays WHERE puzzle_id = ? AND date >= ? GROUP BY segment`,
    ).bind(puzzle.id, since),
    db.prepare(
      `SELECT COUNT(*) AS seen, SUM(p.converted_at IS NOT NULL AND p.converted_at > p.paywall_seen_at) AS converted
       FROM players p
       WHERE p.paywall_seen_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM paywall_views v WHERE v.uid = p.uid AND v.puzzle_id = ? AND v.shadow = 0)`,
    ).bind(puzzle.id),
  ]);
  const rows = dayRes.results as DayStats[];
  const paywall = new Map((paywallRes.results as { date: string; real: number; shadow: number }[]).map((r) => [r.date, r]));
  const players = Object.fromEntries((playersRes.results as { segment: string; n: number }[]).map((r) => [r.segment, r.n]));
  const conv = (conversionRes.results[0] ?? { seen: 0, converted: 0 }) as { seen: number; converted: number | null };

  const total = rows.reduce((a, r) => ({
    plays: a.plays + r.plays, finished: a.finished + r.finished, won: a.won + r.won,
  }), { plays: 0, finished: 0, won: 0 });
  const paywallTotal = [...paywall.values()].reduce((a, r) => ({ real: a.real + r.real, shadow: a.shadow + r.shadow }), { real: 0, shadow: 0 });
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  const base = `/admin/p/${puzzle.id}/stats`;

  return c.html(
    <Layout title={puzzle.name} adminEmail={c.get("adminEmail")}>
      <PuzzleHeader puzzle={puzzle} tab="stats" />
      <nav class="subtabs">
        {[7, 30, 90].map((d) => <a href={`${base}?days=${d}`} class={d === days ? "active" : ""}>{d} Tage</a>)}
      </nav>

      <div class="card">
        <div class="stats">
          <div><strong>{total.plays}</strong><span>Spiele</span></div>
          <div><strong>{pct(total.won, total.finished)}</strong><span>Gewinnrate</span></div>
          <div><strong>{players.member ?? 0}</strong><span>Members</span></div>
          <div><strong>{players.nonmember ?? 0}</strong><span>Nicht-Members</span></div>
          <div><strong>{players.former ?? 0}</strong><span>Ehemalige</span></div>
          <div><strong>{players.anon ?? 0}</strong><span>ohne Newsletter-Link</span></div>
        </div>
        <p class="hint" style="margin-bottom: 0">Personen = verschiedene Spieler:innen im Zeitraum.</p>
      </div>

      <div class="card">
        <h2 style="margin-top: 0">Paywall</h2>
        <div class="stats">
          <div><strong>{paywallTotal.real}</strong><span>Paywall gesehen</span></div>
          <div><strong>{paywallTotal.shadow}</strong><span>wären gesperrt worden (Testbetrieb)</span></div>
          <div><strong>{conv.converted ?? 0} / {conv.seen}</strong><span>danach Member geworden (gesamt)</span></div>
        </div>
        <p class="hint" style="margin-bottom: 0">
          Gezählt pro Person und Tag. «Member geworden» heisst: Die Person kam nach der Paywall mit einem Member-Link zurück.
        </p>
      </div>

      <div class="card">
        <h2 style="margin-top: 0">Pro Tag</h2>
        {rows.length === 0 ? <p>Noch keine Spiele im Zeitraum.</p> : (
          <div style="overflow-x: auto">
            <table>
              <thead>
                <tr><th>Tag</th><th>Spiele</th><th>Gewinnrate</th><th>Ø Versuche</th><th>Ø Zeit</th>
                  <th>Members</th><th>Nicht-M.</th><th>Ehem.</th><th>Anonym</th><th>Paywall</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pw = paywall.get(r.date);
                  return (
                    <tr>
                      <td style="white-space: nowrap">{formatDateCH(r.date)}</td>
                      <td>{r.plays}</td>
                      <td>{pct(r.won, r.finished)}</td>
                      <td>{r.avg_attempts ?? "–"}</td>
                      <td>{r.avg_time !== null ? `${Math.floor(r.avg_time / 60)}:${String(r.avg_time % 60).padStart(2, "0")}` : "–"}</td>
                      <td>{r.member}</td><td>{r.nonmember}</td><td>{r.former}</td><td>{r.anon}</td>
                      <td>{pw ? `${pw.real}${pw.shadow ? ` (+${pw.shadow} Test)` : ""}` : 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>,
  );
});
