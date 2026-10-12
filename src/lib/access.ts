import { addDays, isoWeekday } from "./dates";
import type { PlayerSegment } from "./identity";
import type { PuzzleRow } from "./types";

export type AccessKind = "member" | "open" | "grace" | "trial" | "weekly" | "shadow" | "blocked";

export interface AccessInfo {
  kind: AccessKind;
  /** Gratis-Spiele, die nach dem heutigen noch übrig sind (nur bei trial) */
  trialRemaining: number | null;
  /** Datum des nächsten Gratis-Rätsels, wenn gesperrt */
  nextFree: string | null;
  graceUntil: string | null;
}

export interface PlayerRow {
  uid: string;
  segment: PlayerSegment;
  grace_until: string | null;
  grace_used_at: string | null;
  paywall_seen_at: string | null;
  converted_at: string | null;
}

export const GRACE_HOURS = 48;
export const GRACE_COOLDOWN_DAYS = 30;

export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

function graceActive(player: PlayerRow | null, now: Date): string | null {
  if (!player?.grace_until) return null;
  return new Date(player.grace_until) > now ? player.grace_until : null;
}

/**
 * Entscheidet, ob jemand ein NEUES Spiel starten darf. Ein bereits begonnenes Spiel
 * darf immer zu Ende gespielt werden; das prüft der Aufrufer vorher.
 */
export async function computeAccess(
  db: D1Database,
  puzzle: PuzzleRow,
  player: PlayerRow | null,
  segment: PlayerSegment,
  today: string,
  now = new Date(),
): Promise<AccessInfo> {
  const base = { trialRemaining: null, nextFree: null, graceUntil: null };
  if (segment === "member") return { ...base, kind: "member" };

  const grace = graceActive(player, now);
  if (grace) return { ...base, kind: "grace", graceUntil: grace };

  const uid = player?.uid;
  const counts = uid
    ? await db
        .prepare(
          `SELECT COUNT(*) AS total,
             SUM(CASE WHEN date >= ? AND access IN ('weekly', 'shadow') THEN 1 ELSE 0 END) AS weekly
           FROM plays WHERE puzzle_id = ? AND uid = ? AND access != 'member'`,
        )
        .bind(weekStart(today), puzzle.id, uid)
        .first<{ total: number; weekly: number | null }>()
    : null;
  const played = counts?.total ?? 0;
  const weeklyUsed = counts?.weekly ?? 0;

  if (puzzle.paywall_mode === "off") return { ...base, kind: "open" };

  if (played < puzzle.trial_limit) {
    return { ...base, kind: "trial", trialRemaining: puzzle.trial_limit - played - 1 };
  }
  if (weeklyUsed < puzzle.weekly_free) return { ...base, kind: "weekly" };

  const nextFree = addDays(weekStart(today), 7);
  if (puzzle.paywall_mode === "shadow") return { ...base, kind: "shadow", nextFree };
  return { ...base, kind: "blocked", nextFree };
}
