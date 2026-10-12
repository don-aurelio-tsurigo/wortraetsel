// Erzeugt SQL, das ein Rätsel mit den Texten aus einem bestehenden Wordle (index.html) anlegt.
// Das alte Projekt wird nur gelesen.
//
//   node scripts/seed-from-legacy.mjs <pfad/zu/index.html> <slug> "<Name>" > seed/<slug>.sql
//   npx wrangler d1 execute raetsel --local --file seed/<slug>.sql

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const [file, slug, name] = process.argv.slice(2);
if (!file || !slug || !name) {
  console.error('Aufruf: node scripts/seed-from-legacy.mjs <index.html> <slug> "<Name>"');
  process.exit(1);
}
const html = readFileSync(file, "utf8");

function extractArray(constName) {
  const m = html.match(new RegExp(`const ${constName} = (\\[[\\s\\S]*?\\n\\]);`));
  if (!m) return [];
  // Reine Literal-Arrays aus der eigenen alten Datei
  return Function(`"use strict"; return (${m[1]});`)();
}

const MEMBER_LINK = "https://mitmachen.tsri.ch";
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const puzzleId = randomUUID();
const out = [
  `INSERT INTO puzzles (id, slug, name, type, settings, membership_url) VALUES (${q(puzzleId)}, ${q(slug)}, ${q(name)}, 'wordle', '{"wordLength":5,"maxAttempts":6}', ${q(MEMBER_LINK)});`,
];

let order = 0;
function addMessage(segment, slot, text, buttonText = null, buttonUrl = null) {
  out.push(
    `INSERT INTO puzzle_messages (id, puzzle_id, segment, slot, text, button_text, button_url, sort_order) VALUES (${q(randomUUID())}, ${q(puzzleId)}, ${q(segment)}, ${q(slot)}, ${q(text)}, ${q(buttonText)}, ${q(buttonUrl)}, ${++order});`,
  );
}

const titles = extractArray("TITLE_WORDS");
const wins = extractArray("MESSAGES");
const losses = extractArray("LOSE_MESSAGES");

for (const t of titles) addMessage("all", "win_title", t);
for (const m of wins) {
  // Member-CTAs (Link auf mitmachen.tsri.ch) gehen nur an Nicht-Members
  const segment = m.buttonLink === MEMBER_LINK ? "nonmember" : "all";
  addMessage(segment, "win", m.text, m.buttonLabel ?? null, m.buttonLink ?? null);
}
for (const t of losses) addMessage("all", "lose", typeof t === "string" ? t : t.text);

console.log(out.join("\n"));
console.error(`${slug}: ${titles.length} Titel, ${wins.length} Sieg-Sprüche, ${losses.length} Niederlage-Sprüche`);
