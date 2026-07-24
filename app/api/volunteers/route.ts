import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, ensureDatabase, writeAuditEvent } from "@/app/lib/database";

export const dynamic = "force-dynamic";

const volunteerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(240),
  contactPlatform: z.enum(["whatsapp", "telegram", "discord"]),
  contactHandle: z.string().trim().min(2).max(100).regex(/^[^\r\n<>]+$/),
  skills: z.array(z.enum(["translation", "source-review", "accessibility", "editorial", "technical", "tech-team"])).min(1).max(5),
  languages: z.array(z.string().trim().min(2).max(40)).min(1).max(8),
  availability: z.string().trim().min(2).max(160),
  note: z.string().trim().min(20).max(1500),
  language: z.enum(["en", "hi"]),
  consent: z.literal(true),
  website: z.string().max(0),
  startedAt: z.number().int().positive(),
});

function validationResponse(error: z.ZodError) {
  const field = String(error.issues[0]?.path[0] ?? "");
  const messages: Record<string, string> = {
    name: "Name or alias must be between 2 and 100 characters.",
    email: "Enter a valid email address.",
    contactPlatform: "Choose WhatsApp, Telegram, or Discord.",
    contactHandle: "Handle or username must be between 2 and 100 characters.",
    skills: "Select at least one way you can help.",
    languages: "Enter at least one language, using 2 to 40 characters for each.",
    availability: "Availability must be between 2 and 160 characters.",
    note: "Experience and motivation must be between 20 and 1,500 characters.",
    consent: "Consent is required before submitting.",
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
    const body = volunteerSchema.parse(await request.json());
    if (Date.now() - body.startedAt < 2500) {
      return NextResponse.json({ ok: true }, { status: 202 });
    }
    const identifier = remoteIdentifier(request);
    const allowed = await consumeRateLimit("volunteer-submit", identifier, 3, 60 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        { status: 429 },
      );
    }
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO volunteer_submissions
        (id, name, email, contact_platform, contact_handle,
         skills_json, languages_json, availability, note,
         language, status, internal_notes, consented_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', ?, ?, ?)`,
      args: [
        id,
        body.name,
        body.email.toLowerCase(),
        body.contactPlatform,
        body.contactHandle,
        JSON.stringify(body.skills),
        JSON.stringify(body.languages),
        body.availability,
        body.note,
        body.language,
        now,
        now,
        now,
      ],
    });
    await writeAuditEvent(null, "submitted", "volunteer", id, {
      language: body.language,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return validationResponse(error);
    const message =
      error instanceof Error
        ? error.message
        : "Unable to accept the submission.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
