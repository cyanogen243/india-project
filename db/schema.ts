import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["super_admin", "admin"] }).notNull(),
    passwordHash: text("password_hash").notNull(),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(true),
    temporaryPasswordExpiresAt: text("temporary_password_expires_at"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastLoginAt: text("last_login_at"),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const volunteerSubmissions = sqliteTable(
  "volunteer_submissions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    contactPlatform: text("contact_platform", {
      enum: ["whatsapp", "telegram", "discord"],
    })
      .notNull()
      .default("telegram"),
    contactHandle: text("contact_handle").notNull().default(""),
    city: text("city").notNull().default(""),
    team: text("team").notNull().default(""),
    skillsJson: text("skills_json").notNull(),
    languagesJson: text("languages_json").notNull(),
    availability: text("availability").notNull(),
    note: text("note").notNull(),
    language: text("language", { enum: ["en", "hi"] }).notNull(),
    status: text("status", {
      enum: ["new", "contacted", "accepted", "declined", "archived"],
    })
      .notNull()
      .default("new"),
    internalNotes: text("internal_notes").notNull().default(""),
    consentedAt: text("consented_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    retentionEligibleAt: text("retention_eligible_at"),
  },
  (table) => [
    index("volunteers_status_idx").on(table.status),
    index("volunteers_created_idx").on(table.createdAt),
    index("volunteers_team_idx").on(table.team),
  ],
);

export const contentEntries = sqliteTable(
  "content_entries",
  {
    id: text("id").primaryKey(),
    collection: text("collection").notNull(),
    recordId: text("record_id").notNull(),
    language: text("language", { enum: ["en", "hi"] }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    draftJson: text("draft_json").notNull(),
    publishedJson: text("published_json"),
    version: integer("version").notNull().default(1),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by"),
    publishedBy: text("published_by"),
  },
  (table) => [
    uniqueIndex("content_collection_record_language_unique").on(
      table.collection,
      table.recordId,
      table.language,
    ),
    index("content_collection_order_idx").on(table.collection, table.sortOrder),
  ],
);

export const feedReleases = sqliteTable("feed_releases", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  signature: text("signature").notNull(),
  publicKey: text("public_key").notNull(),
  generatedAt: text("generated_at").notNull(),
  createdBy: text("created_by"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("audit_created_idx").on(table.createdAt)],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    action: text("action").notNull(),
    count: integer("count").notNull().default(0),
    windowStartedAt: text("window_started_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("rate_limits_expiry_idx").on(table.expiresAt)],
);

export const visitorTotals = sqliteTable("visitor_totals", {
  id: text("id").primaryKey(),
  total: integer("total").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const contributions = sqliteTable(
  "contributions",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["poster", "image", "poem", "essay"] }).notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    credit: text("credit").notNull().default(""),
    creditAccount: text("credit_account").notNull().default(""),
    body: text("body").notNull().default(""),
    language: text("language", { enum: ["en", "hi"] }).notNull(),
    storageKey: text("storage_key"),
    socialStorageKey: text("social_storage_key"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    byteSize: integer("byte_size"),
    status: text("status", {
      enum: ["pending", "approved", "declined", "withdrawn"],
    })
      .notNull()
      .default("pending"),
    internalNotes: text("internal_notes").notNull().default(""),
    contentFingerprint: text("content_fingerprint"),
    seeded: integer("seeded", { mode: "boolean" }).notNull().default(false),
    // Scaffolding that ships so the wall is never empty, distinct from the
    // permanent collection; the admin panel counts these so they are not
    // quietly kept forever.
    placeholder: integer("placeholder", { mode: "boolean" }).notNull().default(false),
    // "own" is the contributor's work under CC BY-NC-SA; "public_domain" is
    // someone else's work passed on, where credit names the original author
    // and sourceUrl is the licence page a moderator checked.
    provenance: text("provenance", { enum: ["own", "public_domain"] })
      .notNull()
      .default("own"),
    sourceUrl: text("source_url").notNull().default(""),
    declineReason: text("decline_reason", {
      enum: [
        "off_topic",
        "not_own_work",
        "not_public_domain",
        "identifying_info",
        "low_quality",
        "duplicate",
        "other",
      ],
    }),
    recoveryCodeHash: text("recovery_code_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
  },
  (table) => [
    uniqueIndex("contributions_recovery_code_unique").on(table.recoveryCodeHash),
    index("contributions_status_idx").on(table.status),
    index("contributions_fingerprint_idx").on(table.contentFingerprint),
    index("contributions_created_idx").on(table.createdAt),
  ],
);

export const visitorDailyIdentifiers = sqliteTable(
  "visitor_daily_identifiers",
  {
    identifierHash: text("identifier_hash").primaryKey(),
    visitDate: text("visit_date").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("visitor_daily_date_idx").on(table.visitDate)],
);
