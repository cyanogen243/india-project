import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, ensureDatabase, writeAuditEvent } from "@/app/lib/database";
import {
  ERASED_CONTRIBUTION_COLUMNS,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "@/app/lib/contributions";
import {
  StoredObjectsNotReleased,
  releaseStoredObjects,
} from "@/app/lib/stored-objects";
import { remoteIdentifier } from "@/app/lib/request-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const lookupSchema = z.object({
  code: z.string().trim().min(4).max(32),
  action: z.enum(["status", "withdraw"]).default("status"),
});

export async function POST(request: NextRequest) {
  try {
    const input = lookupSchema.parse(await request.json());

    // Codes are the only credential guarding a submission, so this endpoint is
    // the enumeration surface. The limit is far tighter than the upload route.
    const allowed = await consumeRateLimit(
      "contribution-lookup",
      remoteIdentifier(request),
      10,
      15 * 60 * 1000,
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429 },
      );
    }

    const db = await ensureDatabase();
    const result = await db.execute({
      sql: `SELECT id, kind, title, status, decline_reason, storage_key,
                   social_storage_key, created_at, updated_at
            FROM contributions WHERE recovery_code_hash = ?`,
      args: [hashRecoveryCode(normalizeRecoveryCode(input.code))],
    });
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ error: "No submission found for that code." }, { status: 404 });
    }

    if (input.action === "withdraw") {
      if (row.status === "withdrawn") {
        return NextResponse.json({ error: "That submission is already withdrawn." }, { status: 409 });
      }
      // Withdrawal is the contributor's decision and takes effect immediately.
      // The stored files go with it, otherwise a "removed" poster stays
      // downloadable to anyone still holding its URL.
      try {
        await releaseStoredObjects([row.storage_key, row.social_storage_key]);
      } catch (error) {
        if (!(error instanceof StoredObjectsNotReleased)) throw error;
        return NextResponse.json(
          { error: "Your work could not be removed just now. Nothing was changed — please try again." },
          { status: 503 },
        );
      }
      const now = new Date();
      // For a poem or an essay the body IS the work, so nulling the storage
      // keys erases nothing on its own. Someone who takes their writing down —
      // plausibly because it puts them at risk — gets it erased here and now,
      // which is what the UI promises.
      await db.execute({
        sql: `UPDATE contributions
              SET status = 'withdrawn', title = '(withdrawn)',
                  ${ERASED_CONTRIBUTION_COLUMNS},
                  updated_at = ?
              WHERE id = ?`,
        args: [now.toISOString(), row.id],
      });
      await writeAuditEvent(null, "withdrawn", "contribution", String(row.id), {});
      return NextResponse.json({ ok: true, status: "withdrawn" });
    }

    // Fields are listed explicitly rather than spreading the row: internal_notes
    // is written for other moderators and must never reach the contributor.
    return NextResponse.json({
      ok: true,
      submission: {
        // Only approved work carries its id, so a contributor can open the
        // page their work now lives on. A pending id would be a public handle
        // to something still under review.
        id: row.status === "approved" ? row.id : null,
        kind: row.kind,
        title: row.title,
        status: row.status,
        declineReason: row.decline_reason ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Enter the code you were given." }, { status: 400 });
    }
    // Never echoed: a storage failure here carries the bucket name and
    // endpoint, and a database failure carries schema detail.
    console.error("contribution lookup failed", error);
    return NextResponse.json({ error: "Unable to look that up." }, { status: 400 });
  }
}
