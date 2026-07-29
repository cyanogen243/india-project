CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('poster', 'image', 'poem', 'essay')),
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  credit TEXT NOT NULL DEFAULT '',
  credit_account TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
  storage_key TEXT,
  social_storage_key TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
  internal_notes TEXT NOT NULL DEFAULT '',
  content_fingerprint TEXT,
  seeded INTEGER NOT NULL DEFAULT 0,
  placeholder INTEGER NOT NULL DEFAULT 0,
  provenance TEXT NOT NULL DEFAULT 'own'
    CHECK (provenance IN ('own', 'public_domain')),
  source_url TEXT NOT NULL DEFAULT '',
  decline_reason TEXT CHECK (decline_reason IN
    ('off_topic', 'not_own_work', 'not_public_domain', 'identifying_info',
     'low_quality', 'duplicate', 'other')),
  recovery_code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS contributions_recovery_code_unique
  ON contributions(recovery_code_hash);

CREATE INDEX IF NOT EXISTS contributions_status_idx
  ON contributions(status);

CREATE INDEX IF NOT EXISTS contributions_created_idx
  ON contributions(created_at);

CREATE INDEX IF NOT EXISTS contributions_fingerprint_idx
  ON contributions(content_fingerprint);
