CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  temporary_password_expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_unique ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS volunteer_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  skills_json TEXT NOT NULL,
  languages_json TEXT NOT NULL,
  availability TEXT NOT NULL,
  note TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'accepted', 'declined', 'archived')),
  internal_notes TEXT NOT NULL DEFAULT '',
  consented_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retention_eligible_at TEXT
);
CREATE INDEX IF NOT EXISTS volunteers_status_idx ON volunteer_submissions(status);
CREATE INDEX IF NOT EXISTS volunteers_created_idx ON volunteer_submissions(created_at);

CREATE TABLE IF NOT EXISTS content_entries (
  id TEXT PRIMARY KEY NOT NULL,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  draft_json TEXT NOT NULL,
  published_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  published_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS content_collection_record_language_unique
  ON content_entries(collection, record_id, language);
CREATE INDEX IF NOT EXISTS content_collection_order_idx
  ON content_entries(collection, sort_order);

CREATE TABLE IF NOT EXISTS feed_releases (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  signature TEXT NOT NULL,
  public_key TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_by TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events(created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key_hash TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry_idx ON rate_limits(expires_at);
