// Alle Rätseltage rechnen in Zürcher Zeit, als ISO-Datum "YYYY-MM-DD".

export function todayZurich(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** ISO-Wochentag 1=Montag … 7=Sonntag. Rechnet in UTC, da nur das Datum zählt. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDateCH(date: string): string {
  const [y, m, d] = date.split("-");
  const wd = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][isoWeekday(date) - 1];
  return `${wd} ${d}.${m}.${y}`;
}
