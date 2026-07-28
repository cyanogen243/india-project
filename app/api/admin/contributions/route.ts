import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertCsrf, getAdminSession } from "@/app/lib/auth";
import { ensureDatabase, writeAuditEvent } from "@/app/lib/database";
import {
  ESSAY_MAX_LENGTH,
  MAX_UPLOAD_BYTES,
  POEM_MAX_LENGTH,
  contentFingerprint,
  processImage,
} from "@/app/lib/contributions";
import { putObject } from "@/app/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fieldsSchema = z.object({
  kind: z.enum(["poster", "image", "poem", "essay"]),
  title: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(120),
  credit: z.string().trim().max(80),
  creditAccount: z.string().trim().max(120),
  body: z.string().max(ESSAY_MAX_LENGTH),
  language: z.enum(["en", "hi"]),
  status: z.enum(["approved", "pending"]).default("approved"),
});

/**
 * Direct gallery curation by a signed-in admin: no honeypot, no rate limit,
 * no recovery code — the admin panel is the way back to these records. Files
 * still pass through the same re-encode pipeline as public uploads.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAdminSession(request);
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    assertCsrf(request, user);

    const form = await request.formData();
    const fields = fieldsSchema.parse({
      kind: form.get("kind"),
      title: form.get("title"),
      subtitle: form.get("subtitle") ?? "",
      credit: form.get("credit") ?? "",
      creditAccount: form.get("creditAccount") ?? "",
      body: String(form.get("body") ?? "").trim(),
      language: form.get("language"),
      status: form.get("status") ?? "approved",
    });

    const isFileKind = fields.kind === "poster" || fields.kind === "image";

    let storageKey: string | null = null;
    let socialStorageKey: string | null = null;
    let mimeType: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let byteSize: number | null = null;
    let fingerprint: string | null = null;

    if (isFileKind) {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "Images must be 4 MB or smaller." }, { status: 413 });
      }
      const processed = await processImage(new Uint8Array(await file.arrayBuffer()));
      await putObject(processed.printKey, processed.printBytes, processed.mimeType);
      await putObject(processed.socialKey, processed.socialBytes, "image/jpeg");
      storageKey = processed.printKey;
      socialStorageKey = processed.socialKey;
      mimeType = processed.mimeType;
      width = processed.width;
      height = processed.height;
      byteSize = processed.printBytes.byteLength;
      fingerprint = contentFingerprint(processed.printBytes);
    } else {
      if (fields.body.length < 4) {
        return NextResponse.json({ error: "Add the text." }, { status: 400 });
      }
      if (fields.kind === "poem" && fields.body.length > POEM_MAX_LENGTH) {
        return NextResponse.json(
          { error: "Poems can be up to 8,000 characters." },
          { status: 400 },
        );
      }
    }

    const db = await ensureDatabase();
    const now = new Date().toISOString();
    const id = randomUUID();
    // No contributor to return to this record: the stored hash can never match
    // an 8-character code, so lookups cannot claim admin-added work.
    const unusableHash = createHash("sha256").update(`admin:${id}`).digest("hex");
    await db.execute({
      sql: `INSERT INTO contributions
        (id, kind, title, subtitle, credit, credit_account, body, language,
         storage_key, social_storage_key, mime_type, width, height, byte_size,
         status, internal_notes, content_fingerprint, recovery_code_hash,
         reviewed_by, reviewed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Added by admin', ?, ?, ?, ?, ?, ?)`,
      args: [
        id, fields.kind, fields.title, fields.subtitle, fields.credit,
        fields.creditAccount, isFileKind ? "" : fields.body, fields.language,
        storageKey, socialStorageKey, mimeType, width, height, byteSize,
        fields.status, fingerprint, unusableHash, user.id, now, now, now,
      ],
    });
    await writeAuditEvent(user.id, "added", "contribution", id, { kind: fields.kind });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Check the fields." },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to add.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
