-- Rätsel (ein Eintrag pro Newsletter-Rätsel, z.B. 6iBrief, Tsüri)
CREATE TABLE puzzles (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,            -- URL: /{slug}
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'wordle',  -- Spieltyp, erweiterbar
  active         INTEGER NOT NULL DEFAULT 0,
  settings       TEXT NOT NULL DEFAULT '{}',      -- JSON, typ-spezifisch (z.B. wordLength, maxAttempts)
  logo_key       TEXT,                            -- R2-Key
  accent_color   TEXT,
  weekdays       TEXT NOT NULL DEFAULT '[1,2,3,4,5]', -- ISO-Wochentage, an denen ein neues Wort kommt
  paywall_mode   TEXT NOT NULL DEFAULT 'off' CHECK (paywall_mode IN ('off', 'shadow', 'on')),
  trial_limit    INTEGER NOT NULL DEFAULT 20,
  weekly_free    INTEGER NOT NULL DEFAULT 1,
  membership_url TEXT,
  winback_url    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pausen (z.B. Sommerpause): in diesem Zeitraum kommt kein neues Wort
CREATE TABLE puzzle_pauses (
  id         TEXT PRIMARY KEY,
  puzzle_id  TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, -- YYYY-MM-DD, inklusive
  end_date   TEXT NOT NULL, -- YYYY-MM-DD, inklusive
  label      TEXT
);
CREATE INDEX idx_pauses_puzzle ON puzzle_pauses (puzzle_id, start_date);

-- Texte & CTAs pro Zielgruppe und Ort im Spiel
CREATE TABLE puzzle_messages (
  id          TEXT PRIMARY KEY,
  puzzle_id   TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  segment     TEXT NOT NULL CHECK (segment IN ('all', 'member', 'nonmember', 'former')),
  slot        TEXT NOT NULL CHECK (slot IN ('win_title', 'win', 'lose', 'trial_hint', 'paywall')),
  title       TEXT,
  text        TEXT NOT NULL,
  button_text TEXT,
  button_url  TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_puzzle ON puzzle_messages (puzzle_id, segment, slot);

-- Warteschlange der Lösungen. played_on wird beim ersten Abruf eines Rätseltags gesetzt
-- und ist danach fix; mehrere NULL sind in SQLite trotz UNIQUE erlaubt.
CREATE TABLE puzzle_entries (
  id         TEXT PRIMARY KEY,
  puzzle_id  TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  solution   TEXT NOT NULL,
  data       TEXT,             -- JSON für andere Spieltypen
  position   INTEGER NOT NULL,
  played_on  TEXT,             -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (puzzle_id, played_on)
);
CREATE INDEX idx_entries_queue ON puzzle_entries (puzzle_id, played_on, position);
