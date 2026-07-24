CREATE TABLE IF NOT EXISTS visitor_totals (
  id TEXT PRIMARY KEY NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visitor_daily_identifiers (
  identifier_hash TEXT PRIMARY KEY NOT NULL,
  visit_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS visitor_daily_date_idx
  ON visitor_daily_identifiers(visit_date);
