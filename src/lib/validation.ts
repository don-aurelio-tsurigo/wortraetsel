import words from "./words.json";
import type { PuzzleRow } from "./types";

const DICTIONARY = new Set<string>(words as string[]);

export const RESERVED_SLUGS = new Set(["admin", "api", "assets", "static", "favicon.ico", "robots.txt"]);

export function validateSlug(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) {
    return "Slug: 2–40 Zeichen, nur Kleinbuchstaben, Ziffern und Bindestriche.";
  }
  if (RESERVED_SLUGS.has(slug)) return `Der Slug «${slug}» ist reserviert.`;
  return null;
}

/** Leer -> null; sonst muss es eine http(s)-URL sein. */
export function normalizeUrl(value: unknown): { url: string | null; error?: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return { url: null };
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return { url: u.toString() };
  } catch {
    return { url: null, error: `«${raw}» ist kein gültiger Link (muss mit https:// beginnen).` };
  }
}

export function normalizeColor(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null;
}

export function parseSettings(puzzle: Pick<PuzzleRow, "settings">): Record<string, unknown> {
  try {
    const s = JSON.parse(puzzle.settings);
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}

export function wordLength(puzzle: Pick<PuzzleRow, "settings">): number {
  const n = Number(parseSettings(puzzle).wordLength);
  return Number.isInteger(n) && n >= 3 && n <= 10 ? n : 5;
}

/** Zerlegt die Eingabe (Zeilen, Kommas, Leerzeichen) in normalisierte Lösungswörter. */
export function splitSolutions(input: string): string[] {
  return input
    .split(/[\s,;]+/)
    .map((w) => w.trim().toUpperCase())
    .filter(Boolean);
}

export function validateWordleSolution(word: string, length: number): string | null {
  if (/[ÄÖÜß]/.test(word)) return `${word}: Umlaute/ß sind nicht erlaubt (AE/OE/UE/SS verwenden).`;
  if (!/^[A-Z]+$/.test(word)) return `${word}: nur Buchstaben A–Z erlaubt.`;
  if (word.length !== length) return `${word}: muss genau ${length} Buchstaben haben.`;
  return null;
}

export function isInDictionary(word: string): boolean {
  return DICTIONARY.has(word);
}
