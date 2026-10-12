-- Text, der beim Teilen unter das Ergebnis gehängt wird (z.B. "6iBrief abonnieren: 6iBrief.ch/abonnieren")
ALTER TABLE puzzles ADD COLUMN share_text TEXT;

-- Eine Person, erkannt an der Mailchimp-UNIQID aus dem Link (oder anonyme Browser-ID "anon-…").
-- Segment ist der zuletzt gesehene Status; über alle Rätsel hinweg gleich.
CREATE TABLE players (
  uid              TEXT PRIMARY KEY,
  segment          TEXT NOT NULL CHECK (segment IN ('member', 'nonmember', 'former', 'anon')),
  grace_until      TEXT,   -- "Ich bin schon Member": freigeschaltet bis (ISO-Zeitpunkt)
  grace_used_at    TEXT,
  paywall_seen_at  TEXT,   -- erstes Mal Paywall gesehen
  converted_at     TEXT,   -- erstes Mal als Member gesehen, nachdem die Person Nicht-Member/ehemalig war
  first_seen       TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ein Spiel = eine Person × ein Rätselwort. Wird beim ersten gültigen Versuch angelegt
-- (das zählt fürs Trial). Der ganze Spielstand liegt hier, nicht im Browser.
CREATE TABLE plays (
  puzzle_id    TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  uid          TEXT NOT NULL,
  entry_id     TEXT NOT NULL REFERENCES puzzle_entries(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,           -- Tag des ersten Versuchs (Zürich)
  segment      TEXT NOT NULL,
  access       TEXT NOT NULL,           -- member | open | trial | weekly | grace | shadow
  guesses      TEXT NOT NULL DEFAULT '[]',
  attempts     INTEGER NOT NULL DEFAULT 0,
  won          INTEGER,                 -- NULL = läuft noch
  time_seconds INTEGER,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT,
  PRIMARY KEY (puzzle_id, uid, entry_id)
);
CREATE INDEX idx_plays_player ON plays (puzzle_id, uid, date);
CREATE INDEX idx_plays_day ON plays (puzzle_id, date);

-- Paywall-Einblendungen (pro Person, Rätsel und Tag einmal gezählt)
CREATE TABLE paywall_views (
  puzzle_id TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  uid       TEXT NOT NULL,
  date      TEXT NOT NULL,
  segment   TEXT NOT NULL,
  shadow    INTEGER NOT NULL DEFAULT 0, -- 1 = Testbetrieb: wäre gesperrt worden
  PRIMARY KEY (puzzle_id, uid, date)
);
