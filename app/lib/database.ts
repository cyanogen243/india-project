import { createClient, type Client, type InValue } from "@libsql/client";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { seededCollections } from "@/app/lib/content-seed";
import type {
  ContentBundle,
  Correction,
  Demand,
  GovernmentResponse,
  LandingSection,
  ReadingItem,
  Resource,
  TimelineItem,
  Update,
} from "@/app/lib/content";

export const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin')),
    password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1,
    temporary_password_expires_at TEXT, active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email)",
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
    csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_unique ON sessions(token_hash)",
  "CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)",
  `CREATE TABLE IF NOT EXISTS volunteer_submissions (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
    contact_platform TEXT NOT NULL DEFAULT 'telegram', contact_handle TEXT NOT NULL DEFAULT '',
    skills_json TEXT NOT NULL, languages_json TEXT NOT NULL, availability TEXT NOT NULL,
    note TEXT NOT NULL, language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'accepted', 'declined', 'archived')),
    internal_notes TEXT NOT NULL DEFAULT '', consented_at TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, retention_eligible_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS volunteers_status_idx ON volunteer_submissions(status)",
  "CREATE INDEX IF NOT EXISTS volunteers_created_idx ON volunteer_submissions(created_at)",
  `CREATE TABLE IF NOT EXISTS content_entries (
    id TEXT PRIMARY KEY NOT NULL, collection TEXT NOT NULL, record_id TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('en', 'hi')), sort_order INTEGER NOT NULL DEFAULT 0,
    draft_json TEXT NOT NULL, published_json TEXT, version INTEGER NOT NULL DEFAULT 1,
    published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    updated_by TEXT, published_by TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS content_collection_record_language_unique
    ON content_entries(collection, record_id, language)`,
  "CREATE INDEX IF NOT EXISTS content_collection_order_idx ON content_entries(collection, sort_order)",
  `CREATE TABLE IF NOT EXISTS feed_releases (
    id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, signature TEXT NOT NULL,
    public_key TEXT NOT NULL, generated_at TEXT NOT NULL, created_by TEXT,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY NOT NULL, actor_user_id TEXT, action TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_id TEXT, details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events(created_at)",
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key_hash TEXT PRIMARY KEY NOT NULL, action TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS rate_limits_expiry_idx ON rate_limits(expires_at)",
  `CREATE TABLE IF NOT EXISTS visitor_totals (
    id TEXT PRIMARY KEY NOT NULL, total INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS visitor_daily_identifiers (
    identifier_hash TEXT PRIMARY KEY NOT NULL, visit_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS visitor_daily_date_idx ON visitor_daily_identifiers(visit_date)",
  `CREATE TABLE IF NOT EXISTS contributions (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('poster', 'image', 'poem', 'essay')),
    title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
    credit TEXT NOT NULL DEFAULT '', credit_account TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
    storage_key TEXT, social_storage_key TEXT, mime_type TEXT,
    width INTEGER, height INTEGER, byte_size INTEGER,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
    internal_notes TEXT NOT NULL DEFAULT '', content_fingerprint TEXT,
    seeded INTEGER NOT NULL DEFAULT 0,
    decline_reason TEXT CHECK (decline_reason IN
      ('off_topic', 'not_own_work', 'identifying_info', 'low_quality', 'duplicate', 'other')),
    recovery_code_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    reviewed_by TEXT, reviewed_at TEXT, retention_eligible_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS contributions_recovery_code_unique
    ON contributions(recovery_code_hash)`,
  "CREATE INDEX IF NOT EXISTS contributions_status_idx ON contributions(status)",
  `CREATE INDEX IF NOT EXISTS contributions_fingerprint_idx
    ON contributions(content_fingerprint)`,
  "CREATE INDEX IF NOT EXISTS contributions_created_idx ON contributions(created_at)",
];

let client: Client | undefined;
let ready: Promise<Client> | undefined;

export function getDatabaseClient() {
  if (!client) {
    client = createClient({
      url:
        process.env.LIBSQL_URL ??
        process.env.TURSO_DATABASE_URL ??
        "file:./data/the-india-project.db",
      authToken:
        process.env.LIBSQL_AUTH_TOKEN ??
        process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

export async function ensureDatabase() {
  if (!ready) {
    ready = (async () => {
      const db = getDatabaseClient();
      for (const sql of migrationStatements) {
        await db.execute(sql);
      }
      await ensureVolunteerContactColumns(db);
      await seedContent(db);
      return db;
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}

async function ensureVolunteerContactColumns(db: Client) {
  const columns = await db.execute("PRAGMA table_info(volunteer_submissions)");
  const names = new Set(columns.rows.map((row) => String(row.name)));
  if (!names.has("contact_platform")) {
    await db.execute(
      "ALTER TABLE volunteer_submissions ADD COLUMN contact_platform TEXT NOT NULL DEFAULT 'telegram'",
    );
  }
  if (!names.has("contact_handle")) {
    await db.execute(
      "ALTER TABLE volunteer_submissions ADD COLUMN contact_handle TEXT NOT NULL DEFAULT ''",
    );
  }
}

async function seedContent(db: Client) {
  const now = new Date().toISOString();
  const statements = Object.entries(seededCollections).flatMap(
    ([collection, records]) =>
      records.map((record, index) => ({
        sql: `INSERT OR IGNORE INTO content_entries
          (id, collection, record_id, language, sort_order, draft_json, published_json,
           version, published_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        args: [
          randomUUID(),
          collection,
          record.id,
          record.language,
          index,
          JSON.stringify(record),
          JSON.stringify(record),
          now,
          now,
          now,
        ] satisfies InValue[],
      })),
  );
  if (statements.length) await db.batch(statements, "write");
}

export function seedContentBundle(): ContentBundle {
  return {
    updates: seededCollections.updates,
    demands: seededCollections.demands,
    timeline: seededCollections.timeline,
    corrections: seededCollections.corrections,
    readingRoom: seededCollections["reading-room"],
    governmentResponses: seededCollections["government-responses"],
    resources: seededCollections.resources,
    landing: seededCollections.landing,
  };
}

export type PublicContribution = {
  id: string;
  kind: "poster" | "image" | "poem" | "essay";
  title: string;
  subtitle: string;
  credit: string;
  creditAccount: string;
  body: string;
  language: string;
  width: number | null;
  height: number | null;
  createdAt: string;
};

/**
 * Only approved rows are ever returned here. Pending, declined and withdrawn
 * work stays out of every public surface, and the recovery code hash is never
 * part of the selection.
 */
export async function loadApprovedContributions(): Promise<PublicContribution[]> {
  const db = await ensureDatabase();
  const result = await db.execute(
    `SELECT id, kind, title, subtitle, credit, credit_account, body, language,
            width, height, created_at
     FROM contributions
     WHERE status = 'approved'
     ORDER BY created_at DESC`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind) as PublicContribution["kind"],
    title: String(row.title),
    subtitle: String(row.subtitle),
    credit: String(row.credit),
    creditAccount: String(row.credit_account),
    body: String(row.body),
    language: String(row.language),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    createdAt: String(row.created_at),
  }));
}

/**
 * A single approved poem or essay for its read page. Returns null for image
 * kinds and for anything not approved, so pending work never renders.
 */
export async function loadApprovedText(id: string): Promise<PublicContribution | null> {
  const db = await ensureDatabase();
  const result = await db.execute({
    sql: `SELECT id, kind, title, subtitle, credit, credit_account, body,
                 language, width, height, created_at
          FROM contributions
          WHERE id = ? AND status = 'approved' AND kind IN ('poem', 'essay')`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    kind: String(row.kind) as PublicContribution["kind"],
    title: String(row.title),
    subtitle: String(row.subtitle),
    credit: String(row.credit),
    creditAccount: String(row.credit_account),
    body: String(row.body),
    language: String(row.language),
    width: null,
    height: null,
    createdAt: String(row.created_at),
  };
}

export async function loadPublishedContent(): Promise<ContentBundle> {
  try {
    const db = await ensureDatabase();
    const result = await db.execute(
      `SELECT collection, published_json
       FROM content_entries
       WHERE published_json IS NOT NULL
       ORDER BY collection, sort_order, created_at`,
    );
    const grouped = new Map<string, unknown[]>();
    for (const row of result.rows) {
      const collection = String(row.collection);
      const items = grouped.get(collection) ?? [];
      items.push(JSON.parse(String(row.published_json)));
      grouped.set(collection, items);
    }
    return {
      updates: (grouped.get("updates") ?? []) as Update[],
      demands: (grouped.get("demands") ?? []) as Demand[],
      timeline: (grouped.get("timeline") ?? []) as TimelineItem[],
      corrections: (grouped.get("corrections") ?? []) as Correction[],
      readingRoom: (grouped.get("reading-room") ?? []) as ReadingItem[],
      governmentResponses: (grouped.get("government-responses") ??
        []) as GovernmentResponse[],
      resources: (grouped.get("resources") ?? []) as Resource[],
      landing: (grouped.get("landing") ?? []) as LandingSection[],
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Using bundled content because libSQL is unavailable:", error);
    }
    return seedContentBundle();
  }
}

export async function writeAuditEvent(
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  const db = await ensureDatabase();
  await db.execute({
    sql: `INSERT INTO audit_events
      (id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      actorUserId,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      new Date().toISOString(),
    ],
  });
}

export async function consumeRateLimit(
  action: string,
  identifier: string,
  limit: number,
  windowMs: number,
) {
  const db = await ensureDatabase();
  const now = Date.now();
  const secret = process.env.RATE_LIMIT_SECRET ?? process.env.SESSION_SECRET ?? "local-development";
  const keyHash = createHmac("sha256", secret)
    .update(`${action}:${identifier}`)
    .digest("hex");
  const existing = await db.execute({
    sql: "SELECT count, expires_at FROM rate_limits WHERE key_hash = ?",
    args: [keyHash],
  });
  const row = existing.rows[0];
  const expiresAt = row ? Date.parse(String(row.expires_at)) : 0;
  if (!row || expiresAt <= now) {
    await db.execute({
      sql: `INSERT INTO rate_limits
        (key_hash, action, count, window_started_at, expires_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(key_hash) DO UPDATE SET
          action = excluded.action, count = 1,
          window_started_at = excluded.window_started_at,
          expires_at = excluded.expires_at`,
      args: [
        keyHash,
        action,
        new Date(now).toISOString(),
        new Date(now + windowMs).toISOString(),
      ],
    });
    return true;
  }
  const count = Number(row.count);
  if (count >= limit) return false;
  await db.execute({
    sql: "UPDATE rate_limits SET count = count + 1 WHERE key_hash = ?",
    args: [keyHash],
  });
  return true;
}

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashNetworkIdentifier(purpose: string, identifier: string) {
  const secret =
    process.env.RATE_LIMIT_SECRET ??
    process.env.SESSION_SECRET ??
    "local-development";
  return createHmac("sha256", secret)
    .update(`${purpose}:${identifier}`)
    .digest("hex");
}
