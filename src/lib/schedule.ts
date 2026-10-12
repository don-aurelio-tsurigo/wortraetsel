import { addDays, isoWeekday } from "./dates";
import type { EntryRow, PauseRow, PuzzleRow } from "./types";

export function parseWeekdays(puzzle: Pick<PuzzleRow, "weekdays">): number[] {
  try {
    const days = JSON.parse(puzzle.weekdays);
    return Array.isArray(days) ? days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : [];
  } catch {
    return [];
  }
}

/** An Rätseltagen kommt ein neues Wort; an allen anderen Tagen bleibt das letzte aktiv. */
export function isPuzzleDay(date: string, weekdays: number[], pauses: PauseRow[]): boolean {
  if (!weekdays.includes(isoWeekday(date))) return false;
  return !pauses.some((p) => date >= p.start_date && date <= p.end_date);
}

/**
 * Liefert die Lösung für `today`. Am ersten Abruf eines Rätseltags wird das nächste
 * Wort aus der Warteschlange fix auf heute gesetzt. UNIQUE(puzzle_id, played_on)
 * verhindert, dass parallele Abrufe zwei Wörter vergeben.
 */
export async function getEntryForDay(
  db: D1Database,
  puzzleId: string,
  today: string,
  isPuzzleToday: boolean,
): Promise<{ entry: EntryRow | null; queueEmpty: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const assigned = await db
      .prepare("SELECT * FROM puzzle_entries WHERE puzzle_id = ? AND played_on = ?")
      .bind(puzzleId, today)
      .first<EntryRow>();
    if (assigned) return { entry: assigned, queueEmpty: false };

    if (isPuzzleToday) {
      const next = await db
        .prepare(
          "SELECT * FROM puzzle_entries WHERE puzzle_id = ? AND played_on IS NULL ORDER BY position LIMIT 1",
        )
        .bind(puzzleId)
        .first<EntryRow>();
      if (next) {
        try {
          const res = await db
            .prepare("UPDATE puzzle_entries SET played_on = ? WHERE id = ? AND played_on IS NULL")
            .bind(today, next.id)
            .run();
          if (res.meta.changes === 1) return { entry: { ...next, played_on: today }, queueEmpty: false };
        } catch {
          // UNIQUE-Konflikt: ein paralleler Abruf war schneller -> erneut lesen
        }
        continue;
      }
    }

    const last = await db
      .prepare(
        "SELECT * FROM puzzle_entries WHERE puzzle_id = ? AND played_on < ? ORDER BY played_on DESC LIMIT 1",
      )
      .bind(puzzleId, today)
      .first<EntryRow>();
    return { entry: last, queueEmpty: isPuzzleToday };
  }
  return { entry: null, queueEmpty: false };
}

/** Voraussichtliche Daten für die noch ungespielten Wörter (für die Vorschau im Backend). */
export function projectDates(
  upcomingCount: number,
  today: string,
  todayAssigned: boolean,
  weekdays: number[],
  pauses: PauseRow[],
): string[] {
  const dates: string[] = [];
  if (weekdays.length === 0) return dates;
  let day = todayAssigned ? addDays(today, 1) : today;
  // Obergrenze, falls Pausen alles blockieren
  for (let i = 0; dates.length < upcomingCount && i < 3660; i++) {
    if (isPuzzleDay(day, weekdays, pauses)) dates.push(day);
    day = addDays(day, 1);
  }
  return dates;
}
