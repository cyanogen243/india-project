import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, ensureDatabase, rateLimitExceeded, writeAuditEvent } from "@/app/lib/database";
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
  provenance: z.enum(["own", "public_domain"]).default("own"),
  sourceUrl: z.string().trim().max(500),
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
  // Cloudflare sets CF-Connecting-IP itself and appends the client to any
  // inbound X-Forwarded-For, so trusting the first XFF element lets a caller
  // choose their own rate-limit bucket. Prefer the header the edge controls;
  // fall back to the last XFF element, which is the one the nearest proxy
  // appended rather than anything the client sent.
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    request.headers.get("cf-connecting-ip") ||
    forwarded?.[forwarded.length - 1] ||
    "unknown"
  );
}

// SQLite stores text up to the first NUL byte, so a value that passes
// validation can land in the row truncated — short enough to slip under the
// length floors, or empty. Control characters have no place in a title or a
// poem anyway; newlines and tabs stay.
function withoutControlCharacters(value: unknown) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    : value;
}

// The form is bilingual but every rejection it renders comes from here, so a
// Hindi contributor was shown Hindi UI and an English refusal. Messages are
// chosen by the language the submission itself declares.
type Bilingual = { en: string; hi: string };
function say(language: string, message: Bilingual) {
  return language === "hi" ? message.hi : message.en;
}

const MESSAGES = {
  rateLimited: {
    en: "Too many submissions. Please try again later.",
    hi: "बहुत सारे योगदान भेजे जा चुके हैं। थोड़ी देर बाद कोशिश करें।",
  },
  oneCreditMode: {
    en: "Choose either an alias or a public account, not both.",
    hi: "उपनाम या सार्वजनिक खाता — दोनों में से एक चुनें।",
  },
  publicDomainWritingOnly: {
    en: "Public-domain sharing is available for poems and essays.",
    hi: "सार्वजनिक डोमेन का विकल्प कविता और लेख के लिए है।",
  },
  needAuthor: {
    en: "Name the author of the original work.",
    hi: "मूल रचना के लेखक का नाम दें।",
  },
  needSource: {
    en: "Link where this was published, so a volunteer can check it. The link must start with https://",
    hi: "यह कहाँ प्रकाशित है उसका लिंक दें ताकि स्वयंसेवक जाँच सके। लिंक https:// से शुरू होना चाहिए।",
  },
  notYourAccount: {
    en: "Someone else's work cannot be credited to your account.",
    hi: "किसी और की रचना का श्रेय आपके खाते को नहीं दिया जा सकता।",
  },
  unreadableImage: {
    en: "That image could not be read. Try re-saving it as a PNG or JPEG.",
    hi: "यह तस्वीर पढ़ी नहीं जा सकी। इसे PNG या JPEG में दोबारा सहेजकर भेजें।",
  },
} satisfies Record<string, Bilingual>;

export async function POST(request: NextRequest) {
  try {
    // Checked before the body is read, so a caller already over the limit
    // cannot make the server buffer and parse a 4 MB upload. The allowance is
    // only spent once the work is actually stored — a rejected file or a
    // validation error should not cost a visitor an hour of access.
    const identifier = remoteIdentifier(request);
    // Before the body is parsed the declared language is not known yet; the
    // referring page is the next best signal for which copy to send back.
    const requestLanguage = /\/hi(\/|$)/.test(request.headers.get("referer") ?? "") ? "hi" : "en";
    if (await rateLimitExceeded("contribution-submit", identifier, 5)) {
      return NextResponse.json(
        { error: say(requestLanguage, MESSAGES.rateLimited) },
        { status: 429 },
      );
    }

    const form = await request.formData();
    const fields = fieldsSchema.parse({
      kind: form.get("kind"),
      title: withoutControlCharacters(form.get("title")),
      subtitle: withoutControlCharacters(form.get("subtitle") ?? ""),
      credit: withoutControlCharacters(form.get("credit") ?? ""),
      creditAccount: withoutControlCharacters(form.get("creditAccount") ?? ""),
      body: String(withoutControlCharacters(form.get("body") ?? "")).trim(),
      language: form.get("language"),
      consent: form.get("consent"),
      website: form.get("website") ?? "",
      provenance: form.get("provenance") ?? "own",
      sourceUrl: withoutControlCharacters(form.get("sourceUrl") ?? ""),
      startedAt: form.get("startedAt"),
    });

    // One credit mode at a time: an alias for anonymous work, or a public
    // account for credited work — never both.
    if (fields.credit && fields.creditAccount) {
      return NextResponse.json(
        { error: say(fields.language, MESSAGES.oneCreditMode) },
        { status: 400 },
      );
    }

    // Public-domain mode is only offered for writing: verifying that a photo
    // or poster is genuinely free to share needs a licence page a moderator
    // can read, which the admin "add directly" path handles instead.
    if (fields.provenance === "public_domain") {
      if (fields.kind !== "poem" && fields.kind !== "essay") {
        return NextResponse.json(
          { error: say(fields.language, MESSAGES.publicDomainWritingOnly), field: "kind" },
          { status: 400 },
        );
      }
      // Without an author and a source a moderator cannot check the claim, and
      // "public domain" becomes an honour system.
      if (!fields.credit) {
        return NextResponse.json(
          { error: say(fields.language, MESSAGES.needAuthor), field: "credit" },
          { status: 400 },
        );
      }
      if (!/^https:\/\/\S+$/.test(fields.sourceUrl)) {
        return NextResponse.json(
          { error: say(fields.language, MESSAGES.needSource), field: "sourceUrl" },
          { status: 400 },
        );
      }
      if (fields.creditAccount) {
        return NextResponse.json(
          { error: say(fields.language, MESSAGES.notYourAccount), field: "creditAccount" },
          { status: 400 },
        );
      }
    }

    // Anything submitted faster than a human could fill the form is accepted
    // silently, so a bot gets no signal about why it failed. `startedAt` comes
    // from the visitor's own clock, so a negative elapsed time means their
    // device runs ahead of ours, not that they are a bot — trapping that would
    // silently discard real work from anyone with an unsynced phone.
    const elapsed = Date.now() - fields.startedAt;
    if (elapsed >= 0 && elapsed < 2500) {
      return NextResponse.json({ ok: true }, { status: 202 });
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

    const allowed = await consumeRateLimit(
      "contribution-submit",
      identifier,
      5,
      60 * 60 * 1000,
    );
    if (!allowed) {
      return NextResponse.json(
        { error: say(fields.language, MESSAGES.rateLimited) },
        { status: 429 },
      );
    }

    const code = generateRecoveryCode();
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO contributions
        (id, kind, title, subtitle, credit, credit_account, provenance, source_url,
         body, language, storage_key, social_storage_key, mime_type, width, height,
         byte_size, status, internal_notes, content_fingerprint, recovery_code_hash,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, ?, ?)`,
      args: [
        id,
        fields.kind,
        fields.title,
        fields.subtitle,
        fields.credit,
        fields.creditAccount,
        fields.provenance,
        fields.provenance === "public_domain" ? fields.sourceUrl : "",
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
    // Image decoders and the storage client both raise messages written for
    // us — libvips internals, bucket hostnames. The contributor gets written
    // copy; the detail stays in the server log.
    console.error("contribution submit failed", error);
    const raw = error instanceof Error ? error.message : "";
    const message = /Only PNG, JPEG and WebP images are accepted/.test(raw)
      ? raw
      : say(/\/hi(\/|$)/.test(request.headers.get("referer") ?? "") ? "hi" : "en", MESSAGES.unreadableImage);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
