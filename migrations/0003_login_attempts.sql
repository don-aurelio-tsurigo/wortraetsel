-- Fehlgeschlagene Backend-Logins, für die Sperre nach zu vielen Versuchen
CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts ON login_attempts (at, ip);
