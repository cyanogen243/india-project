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

const CONTRIBUTIONS_TABLE = `CREATE TABLE IF NOT EXISTS contributions (
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
    placeholder INTEGER NOT NULL DEFAULT 0,
    provenance TEXT NOT NULL DEFAULT 'own'
      CHECK (provenance IN ('own', 'public_domain')),
    source_url TEXT NOT NULL DEFAULT '',
    decline_reason TEXT CHECK (decline_reason IN
      ('off_topic', 'not_own_work', 'not_public_domain', 'identifying_info',
       'low_quality', 'duplicate', 'other')),
    recovery_code_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    reviewed_by TEXT, reviewed_at TEXT, retention_eligible_at TEXT
  )`;

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
  CONTRIBUTIONS_TABLE,
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
    const url = process.env.LIBSQL_URL ?? process.env.TURSO_DATABASE_URL;
    // The local-file default is a development convenience. A serverless host
    // discards its filesystem between requests, so falling back to it in
    // production would accept submissions into a database that disappears —
    // and would keep doing so silently.
    if (!url && process.env.NODE_ENV === "production") {
      throw new Error(
        "LIBSQL_URL (or TURSO_DATABASE_URL) must be set in production. " +
          "Without it the app would write to a filesystem that does not persist.",
      );
    }
    client = createClient({
      url: url ?? "file:./data/the-india-project.db",
      authToken: process.env.LIBSQL_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN,
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
      await ensureContributionProvenance(db);
      await seedContent(db);
      return db;
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}

/**
 * Provenance splits "the contributor made this" from "the contributor is
 * passing on someone else's public-domain work", and `placeholder` marks the
 * geometric posters that ship only so the wall is never empty.
 *
 * The two columns add cleanly, but `decline_reason` carries a CHECK constraint
 * and SQLite cannot alter one in place, so a database created before
 * `not_public_domain` existed has to be rebuilt to accept it. The rebuild is
 * guarded on the stored schema text, runs inside a transaction, and copies
 * only the columns both definitions share.
 */
async function ensureContributionProvenance(db: Client) {
  const columns = await db.execute("PRAGMA table_info(contributions)");
  if (columns.rows.length === 0) return;
  const names = new Set(columns.rows.map((row) => String(row.name)));

  if (!names.has("provenance")) {
    await db.execute(
      "ALTER TABLE contributions ADD COLUMN provenance TEXT NOT NULL DEFAULT 'own'",
    );
  }
  if (!names.has("source_url")) {
    await db.execute("ALTER TABLE contributions ADD COLUMN source_url TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("placeholder")) {
    await db.execute("ALTER TABLE contributions ADD COLUMN placeholder INTEGER NOT NULL DEFAULT 0");
  }

  const schema = await db.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contributions'",
  );
  const existing = String(schema.rows[0]?.sql ?? "");
  if (!existing || existing.includes("not_public_domain")) return;

  // Build the replacement first and ask the database which columns it has,
  // rather than parsing the CREATE statement: two columns can share a line,
  // and a filter that misses one silently drops that data.
  const rebuilt = CONTRIBUTIONS_TABLE.replace(
    "CREATE TABLE IF NOT EXISTS contributions",
    "CREATE TABLE contributions_rebuilt",
  );
  // An orphan left by an interrupted attempt would otherwise make every later
  // boot throw, and ensureDatabase() clears its cached promise on failure, so
  // every request would retry and fail forever.
  await db.execute("DROP TABLE IF EXISTS contributions_rebuilt");
  await db.execute(rebuilt);

  const [live, target] = await Promise.all([
    db.execute("PRAGMA table_info(contributions)"),
    db.execute("PRAGMA table_info(contributions_rebuilt)"),
  ]);
  const targetNames = new Set(target.rows.map((row) => String(row.name)));
  // Only columns both definitions have: a column dropped from the schema must
  // not make the copy fail on every deployment at once.
  const shared = live.rows
    .map((row) => String(row.name))
    .filter((name) => targetNames.has(name))
    .map((name) => `"${name}"`)
    .join(", ");

  // One batch, one transaction for the destructive half. Issuing
  // BEGIN/COMMIT as separate statements is not a transaction on a remote
  // libSQL client, which is exactly where this runs in production — a failure
  // between DROP and RENAME would leave the table missing. The indexes are
  // recreated inside it too, so there is never a window where the table has no
  // unique index on recovery_code_hash.
  await db.batch(
    [
      `INSERT INTO contributions_rebuilt (${shared}) SELECT ${shared} FROM contributions`,
      "DROP TABLE contributions",
      "ALTER TABLE contributions_rebuilt RENAME TO contributions",
      ...migrationStatements.filter(
        (statement) => statement.includes("INDEX") && statement.includes("contributions"),
      ),
    ],
    "write",
  );
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
  // "own" is the contributor's own work under CC BY-NC-SA; "public_domain" is
  // someone else's work passed on, where `credit` names the original author
  // and `sourceUrl` is where a moderator verified it.
  provenance: "own" | "public_domain";
  sourceUrl: string;
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
    `SELECT id, kind, title, subtitle, credit, credit_account, provenance,
            source_url, body, language, width, height, created_at
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
    provenance: String(row.provenance) as PublicContribution["provenance"],
    sourceUrl: String(row.source_url ?? ""),
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
    sql: `SELECT id, kind, title, subtitle, credit, credit_account, provenance,
                 source_url, body, language, width, height, created_at
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
    provenance: String(row.provenance) as PublicContribution["provenance"],
    sourceUrl: String(row.source_url ?? ""),
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

/**
 * The rate limiter and visitor counter both key on an IP-derived HMAC. In
 * production that secret is what stops a leaked database from being replayed
 * against a candidate IP range to identify who submitted a given poster, so a
 * missing secret is refused rather than quietly replaced by a constant that is
 * published in this repository.
 */
function networkHashSecret() {
  const secret = process.env.RATE_LIMIT_SECRET ?? process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("RATE_LIMIT_SECRET (or SESSION_SECRET) must be set in production.");
  }
  return "local-development";
}

/**
 * Reports whether the caller is already over its limit without spending any of
 * the allowance. Callers that do expensive work before they know a request is
 * valid check first and consume only once the work is actually stored, so a
 * rejected attempt does not cost a visitor an hour of access.
 */
export async function rateLimitExceeded(action: string, identifier: string, limit: number) {
  const db = await ensureDatabase();
  const keyHash = createHmac("sha256", networkHashSecret())
    .update(`${action}:${identifier}`)
    .digest("hex");
  const existing = await db.execute({
    sql: "SELECT count, expires_at FROM rate_limits WHERE key_hash = ?",
    args: [keyHash],
  });
  const row = existing.rows[0];
  if (!row) return false;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) return false;
  return Number(row.count) >= limit;
}

export async function consumeRateLimit(
  action: string,
  identifier: string,
  limit: number,
  windowMs: number,
) {
  const db = await ensureDatabase();
  const now = Date.now();
  const secret = networkHashSecret();
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
  const secret = networkHashSecret();
  return createHmac("sha256", secret)
    .update(`${purpose}:${identifier}`)
    .digest("hex");
}
