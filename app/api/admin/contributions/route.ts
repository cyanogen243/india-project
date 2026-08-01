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
import { discardStoredObjects, putProcessedImage } from "@/app/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fieldsSchema = z.object({
  kind: z.enum(["poster", "image", "poem", "essay"]),
  // Curation is the path for public-domain photographs and artwork: a
  // moderator can read a licence page, which is why the public form offers
  // public domain for writing only.
  provenance: z.enum(["own", "public_domain"]).default("own"),
  sourceUrl: z.string().trim().max(500),
  placeholder: z.enum(["yes", ""]).optional(),
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
  // Curation stores the same two objects the public form does, and until now
  // had none of its protection: a failed insert left files no row pointed at,
  // and every path that deletes an object starts from a row. A moderator adding
  // a public-domain photograph deserves the same guarantee as a contributor.
  const written: string[] = [];
  try {
    const user = await getAdminSession(request);
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    assertCsrf(request, user);

    const form = await request.formData();
    const fields = fieldsSchema.parse({
      kind: form.get("kind"),
      title: form.get("title"),
      provenance: form.get("provenance") ?? "own",
      sourceUrl: form.get("sourceUrl") ?? "",
      placeholder: form.get("placeholder") ?? "",
      subtitle: form.get("subtitle") ?? "",
      credit: form.get("credit") ?? "",
      creditAccount: form.get("creditAccount") ?? "",
      body: String(form.get("body") ?? "").trim(),
      language: form.get("language"),
      status: form.get("status") ?? "approved",
    });

    // An admin still on a temporary password can mutate nothing else; this
    // route is the one that publishes straight to the public wall, so it is
    // the last place that gate should be missing.
    if (user.mustChangePassword) {
      return NextResponse.json({ error: "Change your password first." }, { status: 403 });
    }
    // One credit mode at a time, and someone else's work is never credited to
    // one of our accounts — the same two rules the public form enforces. The
    // wall prefers creditAccount over credit, so without this a curated
    // public-domain photograph could display our handle in place of the author
    // whose attribution is the entire point of the record.
    if (fields.credit && fields.creditAccount) {
      return NextResponse.json(
        { error: "Choose either an alias or a public account, not both." },
        { status: 400 },
      );
    }
    if (fields.provenance === "public_domain" && fields.creditAccount) {
      return NextResponse.json(
        { error: "Someone else's work cannot be credited to an account here." },
        { status: 400 },
      );
    }

    // Same standard as the public form: a public-domain claim needs an author
    // and a link, or it is unverifiable.
    if (fields.provenance === "public_domain") {
      if (!fields.credit) {
        return NextResponse.json({ error: "Name the author of the original work." }, { status: 400 });
      }
      if (!/^https:\/\/\S+$/.test(fields.sourceUrl)) {
        return NextResponse.json(
          { error: "Link the licence page so another reviewer can check it." },
          { status: 400 },
        );
      }
    }

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
      await putProcessedImage(processed, written);
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
        (id, kind, title, subtitle, credit, credit_account, provenance, source_url,
         placeholder, body, language,
         storage_key, social_storage_key, mime_type, width, height, byte_size,
         status, internal_notes, content_fingerprint, recovery_code_hash,
         reviewed_by, reviewed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Added by admin', ?, ?, ?, ?, ?, ?)`,
      args: [
        id, fields.kind, fields.title, fields.subtitle, fields.credit,
        fields.creditAccount, fields.provenance,
        fields.provenance === "public_domain" ? fields.sourceUrl : "",
        fields.placeholder === "yes" ? 1 : 0,
        isFileKind ? "" : fields.body, fields.language,
        storageKey, socialStorageKey, mimeType, width, height, byteSize,
        fields.status, fingerprint, unusableHash, user.id, now, now, now,
      ],
    });
    // The row exists from here on. An audit line that will not write is worth
    // logging, not worth telling the moderator their work was not saved when it
    // was — they would add it a second time.
    try {
      await writeAuditEvent(user.id, "added", "contribution", id, { kind: fields.kind });
    } catch (auditError) {
      console.error("curated contribution stored but audit line failed", id, auditError);
    }
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    await discardStoredObjects(written);
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
