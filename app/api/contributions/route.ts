import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, ensureDatabase, writeAuditEvent } from "@/app/lib/database";
import {
  MAX_UPLOAD_BYTES,
  contentFingerprint,
  generateRecoveryCode,
  hashRecoveryCode,
  processImage,
} from "@/app/lib/contributions";
import { putObject } from "@/app/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fieldsSchema = z.object({
  kind: z.enum(["image", "writing"]),
  title: z.string().trim().min(2).max(120),
  credit: z.string().trim().max(80),
  body: z.string().trim().max(8000),
  language: z.enum(["en", "hi"]),
  consent: z.literal("yes"),
  website: z.string().max(0),
  startedAt: z.coerce.number().int().positive(),
});

function validationResponse(error: z.ZodError) {
  const field = String(error.issues[0]?.path[0] ?? "");
  const messages: Record<string, string> = {
    kind: "Choose whether you are sharing artwork or writing.",
    title: "Title must be between 2 and 120 characters.",
    credit: "Credit must be 80 characters or fewer.",
    body: "Writing must be 8,000 characters or fewer.",
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
      credit: form.get("credit") ?? "",
      body: form.get("body") ?? "",
      language: form.get("language"),
      consent: form.get("consent"),
      website: form.get("website") ?? "",
      startedAt: form.get("startedAt"),
    });

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

    let storageKey: string | null = null;
    let socialStorageKey: string | null = null;
    let mimeType: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let byteSize: number | null = null;
    let fingerprint: string | null = null;

    if (fields.kind === "image") {
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
    } else if (fields.body.length < 20) {
      return NextResponse.json(
        { error: "Writing must be at least 20 characters.", field: "body" },
        { status: 400 },
      );
    }

    const code = generateRecoveryCode();
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO contributions
        (id, kind, title, credit, body, language, storage_key, social_storage_key,
         mime_type, width, height, byte_size, status, internal_notes,
         content_fingerprint, recovery_code_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, ?, ?)`,
      args: [
        id,
        fields.kind,
        fields.title,
        fields.credit,
        fields.kind === "writing" ? fields.body : "",
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
