// Der Newsletter-Link enthält `id=*|MMERGE3|**|UNIQID|*`. Mailchimp setzt das Member-Feld
// (1 / leer / -1) direkt vor die 10-stellige UNIQID. Bewusst simpel: wer zwei Links
// vergleicht, kann es überlisten – das nehmen wir in Kauf.

export type PlayerSegment = "member" | "nonmember" | "former" | "anon";

export interface Identity {
  uid: string;
  segment: PlayerSegment;
}

const UNIQID = /^[a-zA-Z0-9]{10}$/;
const ANON = /^anon-[a-zA-Z0-9-]{8,40}$/;

/** `id` aus dem Newsletter-Link; `anonId` erzeugt der Browser, falls kein gültiger Link vorliegt. */
export function resolveIdentity(id: unknown, anonId: unknown): Identity | null {
  const raw = typeof id === "string" ? id.trim() : "";
  if (raw.length === 10 && UNIQID.test(raw)) return { uid: raw, segment: "nonmember" };
  if (raw.length === 11 && raw.startsWith("1") && UNIQID.test(raw.slice(1))) {
    return { uid: raw.slice(1), segment: "member" };
  }
  if (raw.length === 12 && raw.startsWith("-1") && UNIQID.test(raw.slice(2))) {
    return { uid: raw.slice(2), segment: "former" };
  }
  const anon = typeof anonId === "string" ? anonId.trim() : "";
  if (ANON.test(anon)) return { uid: anon, segment: "anon" };
  return null;
}

/** Für Texte & Regeln zählen anonyme Spieler:innen als Nicht-Members. */
export function messageSegment(segment: PlayerSegment): "member" | "nonmember" | "former" {
  return segment === "anon" ? "nonmember" : segment;
}
