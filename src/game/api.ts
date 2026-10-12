import { Hono } from "hono";
import type { Context } from "hono";
import { computeAccess, GRACE_COOLDOWN_DAYS, GRACE_HOURS, type AccessInfo, type PlayerRow } from "../lib/access";
import { todayZurich } from "../lib/dates";
import { messageSegment, resolveIdentity, type Identity } from "../lib/identity";
import { getEntryForDay, isPuzzleDay, parseWeekdays } from "../lib/schedule";
import type { EntryRow, Env, MessageRow, PauseRow, PuzzleRow, Slot } from "../lib/types";
import { isInDictionary, parseSettings, wordLength } from "../lib/validation";
import { evaluateGuess, type Feedback } from "../lib/wordle";

type Ctx = Context<{ Bindings: Env }>;

export const api = new Hono<{ Bindings: Env }>();

interface PlayRow {
  puzzle_id: string;
  uid: string;
  entry_id: string;
  date: string;
  segment: string;
  access: string;
  guesses: string;
  attempts: number;
  won: number | null;
  time_seconds: number | null;
}

// ─── Laden ──────────────────────────────────────────────────────

async function loadPuzzle(db: D1Database, slug: string) {
  return db.prepare("SELECT * FROM puzzles WHERE slug = ? AND active = 1").bind(slug).first<PuzzleRow>();
}

function maxAttempts(puzzle: PuzzleRow): number {
  const n = Number(parseSettings(puzzle).maxAttempts);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 6;
}

async function loadTodaysEntry(db: D1Database, puzzle: PuzzleRow, today: string) {
  const { results: pauses } = await db
    .prepare("SELECT * FROM puzzle_pauses WHERE puzzle_id = ?")
    .bind(puzzle.id)
    .all<PauseRow>();
  const { entry } = await getEntryForDay(db, puzzle.id, today, isPuzzleDay(today, parseWeekdays(puzzle), pauses));
  return entry;
}

/** Legt die Person an bzw. aktualisiert Segment und «zuletzt gesehen». */
async function upsertPlayer(db: D1Database, identity: Identity): Promise<PlayerRow> {
  const existing = await db.prepare("SELECT * FROM players WHERE uid = ?").bind(identity.uid).first<PlayerRow>();
  if (!existing) {
    await db.prepare("INSERT OR IGNORE INTO players (uid, segment) VALUES (?, ?)").bind(identity.uid, identity.segment).run();
    return { uid: identity.uid, segment: identity.segment, grace_until: null, grace_used_at: null, paywall_seen_at: null, converted_at: null };
  }
  const converted =
    identity.segment === "member" && existing.segment !== "member" && !existing.converted_at;
  await db
    .prepare(
      `UPDATE players SET segment = ?, last_seen = datetime('now'),
         converted_at = CASE WHEN ? THEN datetime('now') ELSE converted_at END
       WHERE uid = ?`,
    )
    .bind(identity.segment, converted ? 1 : 0, identity.uid)
    .run();
  return { ...existing, segment: identity.segment };
}

async function loadPlay(db: D1Database, puzzleId: string, uid: string, entryId: string) {
  return db
    .prepare("SELECT * FROM plays WHERE puzzle_id = ? AND uid = ? AND entry_id = ?")
    .bind(puzzleId, uid, entryId)
    .first<PlayRow>();
}

async function recordPaywallView(db: D1Database, puzzleId: string, identity: Identity, today: string, shadow: boolean) {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO paywall_views (puzzle_id, uid, date, segment, shadow) VALUES (?, ?, ?, ?, ?)")
      .bind(puzzleId, identity.uid, today, identity.segment, shadow ? 1 : 0),
    ...(shadow ? [] : [
      db.prepare("UPDATE players SET paywall_seen_at = COALESCE(paywall_seen_at, datetime('now')) WHERE uid = ?").bind(identity.uid),
    ]),
  ]);
}

async function playerStats(db: D1Database, puzzleId: string, uid: string) {
  const { results } = await db
    .prepare("SELECT won FROM plays WHERE puzzle_id = ? AND uid = ? AND won IS NOT NULL ORDER BY started_at DESC LIMIT 500")
    .bind(puzzleId, uid)
    .all<{ won: number }>();
  let streak = 0;
  while (streak < results.length && results[streak].won === 1) streak++;
  return { played: results.length, won: results.filter((r) => r.won === 1).length, streak };
}

/** Wie viele Gratis-Spiele nach den bisherigen noch übrig sind. */
async function trialRemaining(db: D1Database, puzzle: PuzzleRow, uid: string) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM plays WHERE puzzle_id = ? AND uid = ? AND access != 'member'")
    .bind(puzzle.id, uid)
    .first<{ n: number }>();
  return Math.max(0, puzzle.trial_limit - (row?.n ?? 0));
}

async function messagesFor(db: D1Database, puzzle: PuzzleRow, segment: "member" | "nonmember" | "former") {
  const { results } = await db
    .prepare(
      `SELECT * FROM puzzle_messages WHERE puzzle_id = ? AND active = 1 AND segment IN ('all', ?)
       ORDER BY sort_order, created_at`,
    )
    .bind(puzzle.id, segment)
    .all<MessageRow>();
  const defaultUrl =
    segment === "nonmember" ? puzzle.membership_url
    : segment === "former" ? puzzle.winback_url ?? puzzle.membership_url
    : null;
  const out: Record<Slot, { title: string | null; text: string; buttonText: string | null; buttonUrl: string | null }[]> = {
    win_title: [], win: [], lose: [], trial_hint: [], paywall: [],
  };
  for (const m of results) {
    if (segment === "member" && (m.slot === "trial_hint" || m.slot === "paywall")) continue;
    const url = m.button_url ?? defaultUrl;
    const hasButton = !!(m.button_text && url);
    out[m.slot].push({
      title: m.title,
      text: m.text,
      buttonText: hasButton ? m.button_text : null,
      buttonUrl: hasButton ? url : null,
    });
  }
  return { messages: out, ctaUrl: defaultUrl };
}

function guessesWithFeedback(play: PlayRow, solution: string) {
  const guesses: string[] = JSON.parse(play.guesses);
  return guesses.map((g) => ({ letters: g.split(""), feedback: evaluateGuess(g, solution) }));
}

function publicPlay(play: PlayRow | null, entry: EntryRow) {
  if (!play) return null;
  const finished = play.won !== null;
  return {
    guesses: guessesWithFeedback(play, entry.solution),
    finished,
    won: play.won === 1,
    // Lösung erst nach Spielende
    solution: finished ? entry.solution : null,
    timeSeconds: play.time_seconds,
  };
}

async function readIdentity(c: Ctx, source: "query" | "body", body?: Record<string, unknown>) {
  if (source === "query") return resolveIdentity(c.req.query("id"), c.req.query("anon"));
  return resolveIdentity(body?.id, body?.anon);
}

// ─── GET /api/:slug/state ───────────────────────────────────────

api.get("/:slug/state", async (c) => {
  const db = c.env.DB;
  const puzzle = await loadPuzzle(db, c.req.param("slug"));
  if (!puzzle) return c.json({ ok: false, error: "Dieses Rätsel gibt es nicht." }, 404);
  const identity = await readIdentity(c, "query");
  if (!identity) return c.json({ ok: false, error: "Ungültige Anfrage." }, 400);

  const today = todayZurich();
  const [entry, player] = await Promise.all([loadTodaysEntry(db, puzzle, today), upsertPlayer(db, identity)]);
  const segment = messageSegment(identity.segment);

  const info = {
    name: puzzle.name,
    slug: puzzle.slug,
    logoUrl: puzzle.logo_key ? `/${puzzle.slug}/logo?v=${encodeURIComponent(puzzle.logo_key)}` : null,
    accentColor: puzzle.accent_color,
    wordLength: wordLength(puzzle),
    maxAttempts: maxAttempts(puzzle),
    shareText: puzzle.share_text,
  };
  const { messages, ctaUrl } = await messagesFor(db, puzzle, segment);
  if (!entry) {
    return c.json({ ok: true, puzzle: info, segment, available: false, messages, ctaUrl });
  }

  const play = await loadPlay(db, puzzle.id, identity.uid, entry.id);
  let access: AccessInfo;
  if (play) {
    access = {
      kind: play.access as AccessInfo["kind"],
      trialRemaining: play.access === "trial" ? await trialRemaining(db, puzzle, identity.uid) : null,
      nextFree: null,
      graceUntil: null,
    };
  } else {
    access = await computeAccess(db, puzzle, player, identity.segment, today);
    if (access.kind === "blocked" || access.kind === "shadow") {
      await recordPaywallView(db, puzzle.id, identity, today, access.kind === "shadow");
    }
    // Im Testbetrieb merkt die Person nichts
    if (access.kind === "shadow") access = { ...access, kind: "open", nextFree: null };
  }

  const graceUsed = player.grace_used_at
    && Date.now() - new Date(player.grace_used_at).getTime() < GRACE_COOLDOWN_DAYS * 86400_000;

  return c.json({
    ok: true,
    puzzle: info,
    segment,
    available: true,
    wordId: entry.id,
    play: publicPlay(play, entry),
    access,
    graceAvailable: !graceUsed,
    stats: await playerStats(db, puzzle.id, identity.uid),
    messages,
    ctaUrl,
  });
});

// ─── POST /api/:slug/guess ──────────────────────────────────────

api.post("/:slug/guess", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: "Ungültige Anfrage." }, 400);
  const puzzle = await loadPuzzle(db, c.req.param("slug"));
  if (!puzzle) return c.json({ error: "Dieses Rätsel gibt es nicht." }, 404);
  const identity = await readIdentity(c, "body", body);
  if (!identity) return c.json({ error: "Ungültige Anfrage." }, 400);

  const today = todayZurich();
  const entry = await loadTodaysEntry(db, puzzle, today);
  if (!entry) return c.json({ error: "Aktuell ist kein Rätsel verfügbar." }, 503);
  if (body.wordId && body.wordId !== entry.id) {
    return c.json({ error: "Es gibt ein neues Rätsel. Bitte Seite neu laden.", reload: true }, 409);
  }

  const len = wordLength(puzzle);
  const guess = String(body.guess ?? "").trim().toUpperCase();
  if (!new RegExp(`^[A-Z]{${len}}$`).test(guess)) {
    return c.json({ error: `Bitte genau ${len} Buchstaben eingeben.` }, 400);
  }
  // Die Lösung gilt immer als gültig, auch wenn sie nicht in der Wortliste steht
  const valid = guess === entry.solution || (len === 5 ? isInDictionary(guess) : true);
  if (!valid) return c.json({ validWord: false });

  const player = await upsertPlayer(db, identity);
  let play = await loadPlay(db, puzzle.id, identity.uid, entry.id);

  if (!play) {
    const access = await computeAccess(db, puzzle, player, identity.segment, today);
    if (access.kind === "blocked") {
      await recordPaywallView(db, puzzle.id, identity, today, false);
      return c.json({ paywall: true, access }, 402);
    }
    await db
      .prepare(
        "INSERT OR IGNORE INTO plays (puzzle_id, uid, entry_id, date, segment, access) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(puzzle.id, identity.uid, entry.id, today, identity.segment, access.kind)
      .run();
    play = await loadPlay(db, puzzle.id, identity.uid, entry.id);
    if (!play) return c.json({ error: "Spiel konnte nicht gestartet werden." }, 500);
  }

  const max = maxAttempts(puzzle);
  if (play.won !== null || play.attempts >= max) {
    return c.json({ error: "Dieses Rätsel hast du schon gespielt.", reload: true }, 409);
  }

  const feedback: Feedback[] = evaluateGuess(guess, entry.solution);
  const solved = feedback.every((f) => f === "correct");
  const attempts = play.attempts + 1;
  const finished = solved || attempts >= max;
  const guesses = [...JSON.parse(play.guesses), guess];
  const elapsed = Number(body.elapsedSeconds);
  const timeSeconds = finished && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 86400 ? Math.round(elapsed) : null;

  // attempts = alter Wert: verhindert, dass zwei gleichzeitige Versuche beide zählen
  const res = await db
    .prepare(
      `UPDATE plays SET guesses = ?, attempts = ?, won = ?, time_seconds = ?,
         finished_at = CASE WHEN ? THEN datetime('now') ELSE NULL END
       WHERE puzzle_id = ? AND uid = ? AND entry_id = ? AND attempts = ?`,
    )
    .bind(JSON.stringify(guesses), attempts, finished ? (solved ? 1 : 0) : null, timeSeconds, finished ? 1 : 0,
      puzzle.id, identity.uid, entry.id, play.attempts)
    .run();
  if (res.meta.changes !== 1) return c.json({ error: "Bitte Seite neu laden.", reload: true }, 409);

  return c.json({
    validWord: true,
    feedback,
    solved,
    finished,
    solution: finished ? entry.solution : null,
    stats: finished ? await playerStats(db, puzzle.id, identity.uid) : null,
    trialRemaining: play.access === "trial" && attempts === 1 ? await trialRemaining(db, puzzle, identity.uid) : null,
  });
});

// ─── POST /api/:slug/grace («Ich bin schon Member») ─────────────

api.post("/:slug/grace", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const identity = body ? resolveIdentity(body.id, body.anon) : null;
  if (!identity) return c.json({ ok: false, error: "Ungültige Anfrage." }, 400);
  const puzzle = await loadPuzzle(db, c.req.param("slug"));
  if (!puzzle) return c.json({ ok: false, error: "Dieses Rätsel gibt es nicht." }, 404);

  const player = await upsertPlayer(db, identity);
  if (player.grace_used_at) {
    const since = Date.now() - new Date(player.grace_used_at).getTime();
    if (since < GRACE_COOLDOWN_DAYS * 86400_000) {
      return c.json({
        ok: false,
        error: "Du hast die vorläufige Freischaltung schon genutzt. Sobald dein Member-Status bei uns angekommen ist (meist innert eines Tages), kannst du wieder unbegrenzt spielen.",
      });
    }
  }
  const until = new Date(Date.now() + GRACE_HOURS * 3600_000).toISOString();
  await db
    .prepare("UPDATE players SET grace_until = ?, grace_used_at = ? WHERE uid = ?")
    .bind(until, new Date().toISOString(), identity.uid)
    .run();
  return c.json({ ok: true, graceUntil: until });
});
