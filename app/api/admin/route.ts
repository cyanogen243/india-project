import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ERASED_CONTRIBUTION_COLUMNS,
  ESSAY_MAX_LENGTH,
  POEM_MAX_LENGTH,
} from "@/app/lib/contributions";
import {
  assertCsrf,
  clearSessionCookie,
  generateTemporaryPassword,
  getAdminSession,
  login,
  logout,
  normalizeEmail,
  setSessionCookie,
} from "@/app/lib/auth";
import { hashPassword, verifyPassword } from "@/app/lib/password";
import { editableCollections, validateCollectionParity, validateContentRecord } from "@/app/lib/content-validation";
import { ensureDatabase, writeAuditEvent } from "@/app/lib/database";
import {
  StoredObjectsNotReleased,
  releaseStoredObjects,
} from "@/app/lib/stored-objects";
import { buildSignedFeedRelease } from "@/app/lib/feed";
import type { Update } from "@/app/lib/content";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400) {
  const message =
    error instanceof z.ZodError
      ? error.issues[0]?.message ?? "Invalid request"
      : error instanceof Error
        ? error.message
        : "Unable to complete the request";
  return NextResponse.json({ error: message }, { status });
}

function remoteIdentifier(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

/**
 * Both existing roles may moderate contributions today. Keeping the check in
 * one place means introducing a narrower `reviewer` role later is a change here
 * rather than a hunt through every call site.
 */
function canModerateContributions(user: { role: string }) {
  return user.role === "admin" || user.role === "super_admin";
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAdminSession(request);
    if (!user) return NextResponse.json({ authenticated: false });
    const db = await ensureDatabase();
    const [volunteers, contributions, content, users, audits] = await Promise.all([
      db.execute(`SELECT id, name, email, contact_platform, contact_handle,
                         city, team, skills_json, languages_json, availability,
                         note, language, status, internal_notes, consented_at,
                         created_at, updated_at
                  FROM volunteer_submissions ORDER BY created_at DESC`),
      db.execute(`SELECT id, kind, title, subtitle, credit, credit_account, body,
                         language, provenance, source_url, placeholder,
                         content_fingerprint,
                         storage_key, social_storage_key, mime_type,
                         width, height, byte_size, status, internal_notes, seeded,
                         decline_reason, created_at, updated_at, reviewed_by, reviewed_at
                  FROM contributions ORDER BY created_at DESC`),
      db.execute(`SELECT id, collection, record_id, language, sort_order, draft_json,
                         published_json, version, published_at, updated_at
                  FROM content_entries ORDER BY collection, sort_order, created_at`),
      user.role === "super_admin"
        ? db.execute(`SELECT id, email, display_name, role, must_change_password,
                            temporary_password_expires_at, active, created_at, last_login_at
                     FROM users ORDER BY created_at`)
        : Promise.resolve({ rows: [] }),
      db.execute(`SELECT id, actor_user_id, action, entity_type, entity_id,
                         details_json, created_at
                  FROM audit_events ORDER BY created_at DESC LIMIT 100`),
    ]);
    return NextResponse.json({
      authenticated: true,
      user,
      collections: editableCollections,
      volunteers: volunteers.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        email: String(row.email),
        contactPlatform: String(row.contact_platform),
        contactHandle: String(row.contact_handle),
        city: String(row.city ?? ""),
        team: String(row.team ?? ""),
        skills: JSON.parse(String(row.skills_json)),
        languages: JSON.parse(String(row.languages_json)),
        availability: String(row.availability),
        note: String(row.note),
        language: String(row.language),
        status: String(row.status),
        internalNotes: String(row.internal_notes),
        consentedAt: String(row.consented_at),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      })),
      contributions: contributions.rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        title: String(row.title),
        subtitle: String(row.subtitle),
        credit: String(row.credit),
        creditAccount: String(row.credit_account),
        seeded: Number(row.seeded) === 1,
        body: String(row.body),
        language: String(row.language),
        contentFingerprint: row.content_fingerprint ? String(row.content_fingerprint) : null,
        provenance: String(row.provenance ?? "own"),
        sourceUrl: String(row.source_url ?? ""),
        placeholder: Number(row.placeholder ?? 0) === 1,
        storageKey: row.storage_key ? String(row.storage_key) : null,
        socialStorageKey: row.social_storage_key ? String(row.social_storage_key) : null,
        mimeType: row.mime_type ? String(row.mime_type) : null,
        width: row.width === null ? null : Number(row.width),
        height: row.height === null ? null : Number(row.height),
        byteSize: row.byte_size === null ? null : Number(row.byte_size),
        status: String(row.status),
        internalNotes: String(row.internal_notes),
        declineReason: row.decline_reason ? String(row.decline_reason) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
      })),
      content: content.rows.map((row) => ({
        id: String(row.id),
        collection: String(row.collection),
        recordId: String(row.record_id),
        language: String(row.language),
        sortOrder: Number(row.sort_order),
        draft: JSON.parse(String(row.draft_json)),
        published: row.published_json
          ? JSON.parse(String(row.published_json))
          : null,
        version: Number(row.version),
        publishedAt: row.published_at ? String(row.published_at) : null,
        updatedAt: String(row.updated_at),
      })),
      users: users.rows.map((row) => ({
        id: String(row.id),
        email: String(row.email),
        displayName: String(row.display_name),
        role: String(row.role),
        mustChangePassword: Number(row.must_change_password) === 1,
        temporaryPasswordExpiresAt: row.temporary_password_expires_at
          ? String(row.temporary_password_expires_at)
          : null,
        active: Number(row.active) === 1,
        createdAt: String(row.created_at),
        lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
      })),
      audits: audits.rows.map((row) => ({
        id: String(row.id),
        actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
        action: String(row.action),
        entityType: String(row.entity_type),
        entityId: row.entity_id ? String(row.entity_id) : null,
        details: JSON.parse(String(row.details_json)),
        createdAt: String(row.created_at),
      })),
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "login") {
      const input = z
        .object({
          action: z.literal("login"),
          email: z.string().email(),
          password: z.string().min(1),
        })
        .parse(body);
      const session = await login(
        input.email,
        input.password,
        remoteIdentifier(request),
      );
      const response = NextResponse.json({ ok: true });
      setSessionCookie(response, session.token, session.expires);
      return response;
    }

    const user = await getAdminSession(request);
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    assertCsrf(request, user);
    const db = await ensureDatabase();

    if (body.action === "change_password") {
      const input = z
        .object({
          action: z.literal("change_password"),
          currentPassword: z.string().min(1),
          newPassword: z.string().min(12).max(200),
        })
        .parse(body);
      const current = await db.execute({
        sql: "SELECT password_hash FROM users WHERE id = ?",
        args: [user.id],
      });
      if (
        !current.rows[0] ||
        !(await verifyPassword(input.currentPassword, String(current.rows[0].password_hash)))
      ) {
        throw new Error("Current password is incorrect");
      }
      const now = new Date().toISOString();
      await db.batch(
        [
          {
            sql: `UPDATE users SET password_hash = ?, must_change_password = 0,
                  temporary_password_expires_at = NULL, updated_at = ? WHERE id = ?`,
            args: [await hashPassword(input.newPassword), now, user.id],
          },
          { sql: "DELETE FROM sessions WHERE user_id = ?", args: [user.id] },
        ],
        "write",
      );
      await writeAuditEvent(user.id, "password_changed", "user", user.id);
      const response = NextResponse.json({ ok: true, signedOut: true });
      clearSessionCookie(response);
      return response;
    }

    if (user.mustChangePassword) {
      return NextResponse.json(
        { error: "Change your temporary password before continuing" },
        { status: 403 },
      );
    }

    if (body.action === "volunteer_update") {
      const input = z
        .object({
          action: z.literal("volunteer_update"),
          id: z.string().uuid(),
          status: z.enum(["new", "contacted", "accepted", "declined", "archived"]),
          internalNotes: z.string().max(4000),
        })
        .parse(body);
      const now = new Date();
      await db.execute({
        sql: `UPDATE volunteer_submissions
              SET status = ?, internal_notes = ?, updated_at = ?
              WHERE id = ?`,
        args: [input.status, input.internalNotes, now.toISOString(), input.id],
      });
      await writeAuditEvent(user.id, "updated", "volunteer", input.id, {
        status: input.status,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "volunteer_delete") {
      const input = z
        .object({ action: z.literal("volunteer_delete"), id: z.string().uuid() })
        .parse(body);
      await db.execute({
        sql: "DELETE FROM volunteer_submissions WHERE id = ?",
        args: [input.id],
      });
      await writeAuditEvent(user.id, "deleted", "volunteer", input.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "contribution_update") {
      if (!canModerateContributions(user)) {
        return NextResponse.json({ error: "Not permitted." }, { status: 403 });
      }
      const input = z
        .object({
          action: z.literal("contribution_update"),
          id: z.string().uuid(),
          status: z.enum(["pending", "approved", "declined", "withdrawn"]),
          internalNotes: z.string().max(4000),
          title: z.string().trim().min(2).max(120).optional(),
          subtitle: z.string().trim().max(120).optional(),
          credit: z.string().trim().max(80).optional(),
          creditAccount: z.string().trim().max(120).optional(),
          // A poem edited past the poem cap, or a body emptied entirely, would
          // produce a record the public form refuses — an empty tile, and a
          // word count that reads "1 words".
          // Kind-aware below: this is the wider of the two caps, and a poem is
          // checked against POEM_MAX_LENGTH once `previous.kind` is known.
          body: z.string().min(4).max(ESSAY_MAX_LENGTH).optional(),
          declineReason: z
            .enum([
              "off_topic",
              "not_own_work",
              "not_public_domain",
              "identifying_info",
              "low_quality",
              "duplicate",
              "other",
            ])
            .nullable()
            .default(null),
        })
        .parse(body);
      // Moderator edits go through the same content invariants the public form
      // enforces, so an inline edit cannot produce a record the form would
      // have refused: one credit mode, and a body within its kind's limits.
      // Checked against the row this write would produce, not the fields the
      // request happened to include: sending only `credit` against a row that
      // already has an account left both set, which is exactly the state this
      // guard exists to prevent.
      if (input.status === "declined" && !input.declineReason) {
        return NextResponse.json(
          { error: "Choose a reason so the contributor knows why." },
          { status: 400 },
        );
      }
      const existing = await db.execute({
        sql: `SELECT kind, status, title, subtitle, credit, credit_account,
                     body, storage_key, social_storage_key, provenance
              FROM contributions WHERE id = ?`,
        args: [input.id],
      });
      const previous = existing.rows[0];
      if (!previous) {
        return NextResponse.json({ error: "Contribution not found." }, { status: 404 });
      }
      if (
        input.body !== undefined &&
        previous.kind === "poem" &&
        input.body.length > POEM_MAX_LENGTH
      ) {
        return NextResponse.json(
          { error: "That poem is longer than the form allows." },
          { status: 400 },
        );
      }
      const mergedCredit = input.credit ?? String(previous.credit ?? "");
      const mergedAccount = input.creditAccount ?? String(previous.credit_account ?? "");
      if (mergedCredit && mergedAccount) {
        return NextResponse.json(
          { error: "Choose either an alias or a public account, not both." },
          { status: 400 },
        );
      }
      // The public form holds two further rules for public-domain work, and
      // only the "not both" one above was mirrored here. Clearing the credit
      // and setting an account satisfied it while doing precisely the damage
      // the rules exist to prevent: Tagore's name off the poem and a living
      // person's handle in its place, on a work they did not write.
      if (String(previous.provenance ?? "") === "public_domain") {
        if (!mergedCredit) {
          return NextResponse.json(
            { error: "Name the author of the original work." },
            { status: 400 },
          );
        }
        if (mergedAccount) {
          return NextResponse.json(
            { error: "Someone else's work cannot be credited to an account." },
            { status: 400 },
          );
        }
      }
      // Withdrawal deletes the stored objects and nulls the keys, and a
      // moderator can delete them outright. Approving such a row would put a
      // permanently
      // broken card on the wall and republish work its contributor took down.
      const isFileKind = previous.kind === "poster" || previous.kind === "image";
      // Withdrawal is terminal, for any target status: allowing `pending` would
      // let a row be moved there and approved from there.
      const withdrawnRace = () =>
        NextResponse.json(
          {
            error:
              "The contributor took this down. It cannot be republished without a fresh submission.",
          },
          { status: 409 },
        );
      if (previous.status === "withdrawn" && input.status !== "withdrawn") {
        return withdrawnRace();
      }
      if (input.status === "approved" && isFileKind && !previous.storage_key) {
        return NextResponse.json(
          {
            error:
              "This work's files were deleted when it was withdrawn or purged, so it cannot be published again.",
          },
          { status: 409 },
        );
      }

      const now = new Date();

      // Declining erases the work, as withdrawal does. The row keeps the
      // decision — status, reason, reviewer — and loses the submission.
      //
      // Keyed on the status being written rather than the transition into it,
      // so a second request against an already-terminal row cannot take the
      // ordinary edit path and write the title and body back.
      // The guard above reads the status; the write happens later. Excluding a
      // withdrawn row in the write itself, and checking that it matched, is what
      // stops a withdrawal arriving in between from being overwritten.
      const guardWithdrawn = input.status === "withdrawn" ? "" : " AND status != 'withdrawn'";

      const terminal = input.status === "declined" || input.status === "withdrawn";
      if (terminal) {
        try {
          await releaseStoredObjects([previous.storage_key, previous.social_storage_key]);
        } catch (error) {
          if (!(error instanceof StoredObjectsNotReleased)) throw error;
          return NextResponse.json(
            { error: "The stored files could not be removed, so nothing was changed. Try again." },
            { status: 503 },
          );
        }
        const erased = await db.execute({
          sql: `UPDATE contributions
                SET status = ?, internal_notes = ?, decline_reason = ?, title = ?,
                    ${ERASED_CONTRIBUTION_COLUMNS},
                    reviewed_by = ?, reviewed_at = ?, updated_at = ?
                WHERE id = ?${guardWithdrawn}`,
          args: [
            input.status,
            input.internalNotes,
            input.status === "declined" ? input.declineReason : null,
            input.status === "declined" ? "(declined)" : "(withdrawn)",
            user.id,
            now.toISOString(),
            now.toISOString(),
            input.id,
          ],
        });
        if (erased.rowsAffected === 0) return withdrawnRace();
      } else {
        const edited = await db.execute({
          sql: `UPDATE contributions
                SET status = ?, internal_notes = ?, decline_reason = ?,
                    title = ?, subtitle = ?, credit = ?, credit_account = ?, body = ?,
                    reviewed_by = ?, reviewed_at = ?, updated_at = ?
                WHERE id = ?${guardWithdrawn}`,
          args: [
            input.status,
            input.internalNotes,
            input.status === "declined" ? input.declineReason : null,
            input.title ?? String(previous.title),
            input.subtitle ?? String(previous.subtitle),
            input.credit ?? String(previous.credit),
            input.creditAccount ?? String(previous.credit_account),
            input.body ?? String(previous.body),
            user.id,
            now.toISOString(),
            now.toISOString(),
            input.id,
          ],
        });
        if (edited.rowsAffected === 0) return withdrawnRace();
      }
      await writeAuditEvent(user.id, "reviewed", "contribution", input.id, {
        status: input.status,
      });

      return NextResponse.json({ ok: true });
    }

    if (body.action === "contribution_delete") {
      if (!canModerateContributions(user)) {
        return NextResponse.json({ error: "Not permitted." }, { status: 403 });
      }
      const input = z
        .object({ action: z.literal("contribution_delete"), id: z.string().uuid() })
        .parse(body);
      const existing = await db.execute({
        sql: "SELECT storage_key, social_storage_key FROM contributions WHERE id = ?",
        args: [input.id],
      });
      // Remove the stored files alongside the row. An orphaned object is a
      // poster the team believes it deleted and did not.
      try {
        await releaseStoredObjects([
          existing.rows[0]?.storage_key,
          existing.rows[0]?.social_storage_key,
        ]);
      } catch (error) {
        if (!(error instanceof StoredObjectsNotReleased)) throw error;
        return NextResponse.json(
          { error: "The stored files could not be removed, so nothing was deleted. Try again." },
          { status: 503 },
        );
      }
      await db.execute({
        sql: "DELETE FROM contributions WHERE id = ?",
        args: [input.id],
      });
      await writeAuditEvent(user.id, "deleted", "contribution", input.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "content_save") {
      const input = z
        .object({
          action: z.literal("content_save"),
          id: z.string().uuid().optional(),
          collection: z.string(),
          recordId: z.string().min(2).max(160),
          language: z.enum(["en", "hi"]),
          sortOrder: z.number().int().min(0).max(10000),
          payload: z.record(z.string(), z.unknown()),
        })
        .parse(body);
      if (!editableCollections.includes(input.collection)) {
        throw new Error("Unknown content collection");
      }
      const payload = validateContentRecord(input.collection, input.payload);
      if (payload.id !== input.recordId || payload.language !== input.language) {
        throw new Error("Record ID and language must match the structured content");
      }
      const now = new Date().toISOString();
      const id = input.id ?? randomUUID();
      await db.execute({
        sql: `INSERT INTO content_entries
          (id, collection, record_id, language, sort_order, draft_json,
           version, created_at, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(collection, record_id, language) DO UPDATE SET
            sort_order = excluded.sort_order,
            draft_json = excluded.draft_json,
            version = content_entries.version + 1,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
        args: [
          id,
          input.collection,
          input.recordId,
          input.language,
          input.sortOrder,
          JSON.stringify(payload),
          now,
          now,
          user.id,
        ],
      });
      await writeAuditEvent(user.id, "draft_saved", "content", id, {
        collection: input.collection,
        recordId: input.recordId,
        language: input.language,
      });
      return NextResponse.json({ ok: true, id });
    }

    if (body.action === "content_delete") {
      const input = z
        .object({ action: z.literal("content_delete"), id: z.string().uuid() })
        .parse(body);
      await db.execute({ sql: "DELETE FROM content_entries WHERE id = ?", args: [input.id] });
      await writeAuditEvent(user.id, "deleted", "content", input.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "content_publish_collection") {
      const input = z
        .object({
          action: z.literal("content_publish_collection"),
          collection: z.string(),
        })
        .parse(body);
      if (!editableCollections.includes(input.collection)) {
        throw new Error("Unknown content collection");
      }
      const rows = await db.execute({
        sql: `SELECT id, draft_json FROM content_entries
              WHERE collection = ? ORDER BY sort_order, created_at`,
        args: [input.collection],
      });
      const records = rows.rows.map((row) =>
        validateContentRecord(
          input.collection,
          JSON.parse(String(row.draft_json)),
        ),
      );
      validateCollectionParity(input.collection, records);
      const now = new Date().toISOString();
      const statements = rows.rows.map((row) => ({
          sql: `UPDATE content_entries
                SET published_json = draft_json, published_at = ?, published_by = ?
                WHERE id = ?`,
          args: [now, user.id, String(row.id)],
        }));
      if (input.collection === "updates") {
        const release = await buildSignedFeedRelease(records as unknown as Update[]);
        statements.push(
          { sql: "UPDATE feed_releases SET active = 0 WHERE active = 1", args: [] },
          {
            sql: `INSERT INTO feed_releases
              (id, payload, signature, public_key, generated_at, created_by, active)
              VALUES (?, ?, ?, ?, ?, ?, 1)`,
            args: [
              release.id,
              release.payload,
              release.signature,
              release.publicKey,
              release.generatedAt,
              user.id,
            ],
          },
        );
      }
      await db.batch(statements, "write");
      await writeAuditEvent(user.id, "collection_published", "content", null, {
        collection: input.collection,
        count: records.length,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "user_create") {
      if (user.role !== "super_admin") {
        return NextResponse.json({ error: "Super-admin access required" }, { status: 403 });
      }
      const input = z
        .object({
          action: z.literal("user_create"),
          email: z.string().email(),
          displayName: z.string().trim().min(2).max(100),
          role: z.enum(["admin", "super_admin"]),
        })
        .parse(body);
      const password = generateTemporaryPassword();
      const now = new Date();
      const id = randomUUID();
      await db.execute({
        sql: `INSERT INTO users
          (id, email, display_name, role, password_hash, must_change_password,
           temporary_password_expires_at, active, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?)`,
        args: [
          id,
          normalizeEmail(input.email),
          input.displayName,
          input.role,
          await hashPassword(password),
          new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          user.id,
          now.toISOString(),
          now.toISOString(),
        ],
      });
      await writeAuditEvent(user.id, "created", "user", id, { role: input.role });
      return NextResponse.json({ ok: true, temporaryPassword: password });
    }

    if (body.action === "user_reset_password") {
      if (user.role !== "super_admin") {
        return NextResponse.json({ error: "Super-admin access required" }, { status: 403 });
      }
      const input = z
        .object({ action: z.literal("user_reset_password"), id: z.string().uuid() })
        .parse(body);
      const password = generateTemporaryPassword();
      const now = new Date();
      await db.batch(
        [
          {
            sql: `UPDATE users SET password_hash = ?, must_change_password = 1,
                  temporary_password_expires_at = ?, updated_at = ? WHERE id = ?`,
            args: [
              await hashPassword(password),
              new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
              now.toISOString(),
              input.id,
            ],
          },
          { sql: "DELETE FROM sessions WHERE user_id = ?", args: [input.id] },
        ],
        "write",
      );
      await writeAuditEvent(user.id, "password_reset", "user", input.id);
      return NextResponse.json({ ok: true, temporaryPassword: password });
    }

    if (body.action === "user_set_active") {
      if (user.role !== "super_admin") {
        return NextResponse.json({ error: "Super-admin access required" }, { status: 403 });
      }
      const input = z
        .object({
          action: z.literal("user_set_active"),
          id: z.string().uuid(),
          active: z.boolean(),
        })
        .parse(body);
      if (input.id === user.id && !input.active) {
        throw new Error("You cannot disable your own account");
      }
      if (!input.active) {
        const target = await db.execute({
          sql: "SELECT role FROM users WHERE id = ?",
          args: [input.id],
        });
        if (target.rows[0]?.role === "super_admin") {
          const count = await db.execute(
            "SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND active = 1",
          );
          if (Number(count.rows[0]?.count ?? 0) <= 1) {
            throw new Error("The last active super-admin cannot be disabled");
          }
        }
      }
      await db.batch(
        [
          {
            sql: "UPDATE users SET active = ?, updated_at = ? WHERE id = ?",
            args: [input.active ? 1 : 0, new Date().toISOString(), input.id],
          },
          ...(!input.active
            ? [{ sql: "DELETE FROM sessions WHERE user_id = ?", args: [input.id] }]
            : []),
        ],
        "write",
      );
      await writeAuditEvent(user.id, input.active ? "enabled" : "disabled", "user", input.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown admin action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAdminSession(request);
    if (user) assertCsrf(request, user);
    await logout(request);
    if (user) await writeAuditEvent(user.id, "logout", "session", null);
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
