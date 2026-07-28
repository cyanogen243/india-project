import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, ensureDatabase, writeAuditEvent } from "@/app/lib/database";
import {
  ESSAY_MAX_LENGTH,
  MAX_UPLOAD_BYTES,
  POEM_MAX_LENGTH,
  contentFingerprint,
  generateRecoveryCode,
  hashRecoveryCode,
  processImage,
} from "@/app/lib/contributions";
import { putObject } from "@/app/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fieldsSchema = z.object({
  kind: z.enum(["poster", "image", "poem", "essay"]),
  title: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(120),
  // Exactly one of these carries a value, depending on the credit choice made
  // on the form. Both empty is anonymity; both filled is rejected below.
  credit: z.string().trim().max(80),
  creditAccount: z
    .string()
    .trim()
    .max(120)
    .regex(/^$|^[@a-zA-Z0-9._/:-]+$/, "Handles cannot contain spaces or markup."),
  body: z.string().max(ESSAY_MAX_LENGTH),
  language: z.enum(["en", "hi"]),
  consent: z.literal("yes"),
  website: z.string().max(0),
  startedAt: z.coerce.number().int().positive(),
});

function validationResponse(error: z.ZodError) {
  const field = String(error.issues[0]?.path[0] ?? "");
  const messages: Record<string, string> = {
    kind: "Choose what you are sharing.",
    title: "Title must be between 2 and 120 characters.",
    subtitle: "Subtitle must be 120 characters or fewer.",
    credit: "Name or alias must be 80 characters or fewer.",
    creditAccount: "Enter a handle or profile link without spaces.",
    body: "That text is too long.",
    consent: "Confirmation is required before submitting.",
  };
  return NextResponse.json(
    {
      error: messages[field] ?? "Please check every required field.",
      ...(field in messages ? { field } : {}),
    },
    { status: 400 },
  );
}

function remoteIdentifier(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const fields = fieldsSchema.parse({
      kind: form.get("kind"),
      title: form.get("title"),
      subtitle: form.get("subtitle") ?? "",
      credit: form.get("credit") ?? "",
      creditAccount: form.get("creditAccount") ?? "",
      body: String(form.get("body") ?? "").trim(),
      language: form.get("language"),
      consent: form.get("consent"),
      website: form.get("website") ?? "",
      startedAt: form.get("startedAt"),
    });

    // One credit mode at a time: an alias for anonymous work, or a public
    // account for credited work — never both.
    if (fields.credit && fields.creditAccount) {
      return NextResponse.json(
        { error: "Choose either an alias or a public account, not both." },
        { status: 400 },
      );
    }

    // Anything submitted faster than a human could fill the form is accepted
    // silently, so a bot gets no signal about why it failed.
    if (Date.now() - fields.startedAt < 2500) {
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    const identifier = remoteIdentifier(request);
    const allowed = await consumeRateLimit(
      "contribution-submit",
      identifier,
      5,
      60 * 60 * 1000,
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        { status: 429 },
      );
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
        return NextResponse.json(
          { error: "Choose an image to share.", field: "file" },
          { status: 400 },
        );
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: "Images must be 4 MB or smaller.", field: "file" },
          { status: 413 },
        );
      }
      const input = new Uint8Array(await file.arrayBuffer());
      const processed = await processImage(input);
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
      // Deliberately low floor: Devanagari says in a handful of characters
      // what English needs a sentence for.
      if (fields.body.length < 4) {
        return NextResponse.json(
          { error: "Add a few more characters.", field: "body" },
          { status: 400 },
        );
      }
      if (fields.kind === "poem" && fields.body.length > POEM_MAX_LENGTH) {
        return NextResponse.json(
          {
            error: "Poems can be up to 8,000 characters. Longer work fits as an essay.",
            field: "body",
          },
          { status: 400 },
        );
      }
    }

    const code = generateRecoveryCode();
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO contributions
        (id, kind, title, subtitle, credit, credit_account, body, language,
         storage_key, social_storage_key, mime_type, width, height, byte_size,
         status, internal_notes, content_fingerprint, recovery_code_hash,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, ?, ?)`,
      args: [
        id,
        fields.kind,
        fields.title,
        fields.subtitle,
        fields.credit,
        fields.creditAccount,
        isFileKind ? "" : fields.body,
        fields.language,
        storageKey,
        socialStorageKey,
        mimeType,
        width,
        height,
        byteSize,
        fingerprint,
        hashRecoveryCode(code),
        now,
        now,
      ],
    });

    // The recovery code is deliberately absent from the audit trail: it is the
    // contributor's only credential and nothing stored should be able to
    // reconstruct it.
    await writeAuditEvent(null, "submitted", "contribution", id, {
      kind: fields.kind,
      language: fields.language,
    });

    return NextResponse.json({ ok: true, recoveryCode: code }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return validationResponse(error);
    const message =
      error instanceof Error ? error.message : "Unable to accept the submission.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
