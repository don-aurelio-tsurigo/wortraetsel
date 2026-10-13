export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_ADMIN_BYPASS?: string;
  /** Secret: Passwort fürs Backend (wrangler secret put ADMIN_PASSWORD) */
  ADMIN_PASSWORD?: string;
}

export type PuzzleType = "wordle";
export type PaywallMode = "off" | "shadow" | "on";
export type Segment = "all" | "member" | "nonmember" | "former";
export type Slot = "win_title" | "win" | "lose" | "trial_hint" | "paywall";

export interface PuzzleRow {
  id: string;
  slug: string;
  name: string;
  type: PuzzleType;
  active: number;
  settings: string;
  logo_key: string | null;
  accent_color: string | null;
  weekdays: string;
  paywall_mode: PaywallMode;
  trial_limit: number;
  weekly_free: number;
  membership_url: string | null;
  winback_url: string | null;
  share_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface PauseRow {
  id: string;
  puzzle_id: string;
  start_date: string;
  end_date: string;
  label: string | null;
}

export interface MessageRow {
  id: string;
  puzzle_id: string;
  segment: Segment;
  slot: Slot;
  title: string | null;
  text: string;
  button_text: string | null;
  button_url: string | null;
  active: number;
  sort_order: number;
}

export interface EntryRow {
  id: string;
  puzzle_id: string;
  solution: string;
  data: string | null;
  position: number;
  played_on: string | null;
}

export const PUZZLE_TYPES: Record<PuzzleType, { label: string; defaultSettings: Record<string, unknown> }> = {
  wordle: { label: "Wordle (Wort erraten)", defaultSettings: { wordLength: 5, maxAttempts: 6 } },
};

export const SEGMENTS: { id: Segment; label: string; hint: string }[] = [
  { id: "all", label: "Für alle", hint: "Wird allen Gruppen gezeigt, zusätzlich zu den gruppenspezifischen Texten." },
  { id: "member", label: "Members", hint: "Keine Paywall und kein Trial-Hinweis." },
  { id: "nonmember", label: "Nicht-Members", hint: "Trial, danach Paywall mit Wochenrätsel." },
  { id: "former", label: "Ehemalige", hint: "Gleiche Regeln wie Nicht-Members, eigene Rückhol-Texte." },
];

export const SLOTS: { id: Slot; label: string; hint: string; button: boolean; title: boolean; memberOnlyHidden?: boolean }[] = [
  { id: "win_title", label: "Titel bei Sieg", hint: "Zufällig gewählte Überschrift im Sieg-Dialog, z.B. «Chapeau!».", button: false, title: false },
  { id: "win", label: "Sprüche bei Sieg", hint: "Pro Sieg wird einer zufällig gezogen. Optional mit Button.", button: true, title: false },
  { id: "lose", label: "Sprüche bei Niederlage", hint: "Pro Niederlage wird einer zufällig gezogen. Optional mit Button.", button: true, title: false },
  { id: "trial_hint", label: "Trial-Hinweis", hint: "Erscheint, wenn noch 5 oder weniger Gratis-Rätsel übrig sind. Platzhalter: {rest} = Gratis-Rätsel nach dem heutigen", button: true, title: false, memberOnlyHidden: true },
  { id: "paywall", label: "Paywall", hint: "Nach Ablauf des Trials, wenn auch das Wochenrätsel gespielt ist. Platzhalter: {naechstesGratis} = z.B. «Montag, 19. Oktober»", button: true, title: true, memberOnlyHidden: true },
];
