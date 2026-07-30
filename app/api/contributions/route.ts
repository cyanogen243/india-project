import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, ensureDatabase, rateLimitExceeded, writeAuditEvent } from "@/app/lib/database";
import {
  ESSAY_MAX_LENGTH,
  MAX_REQUEST_BYTES,
  MAX_UPLOAD_BYTES,
  POEM_MAX_LENGTH,
  contentFingerprint,
  generateRecoveryCode,
  hashRecoveryCode,
  processImage,
} from "@/app/lib/contributions";
import { discardStoredObjects, putProcessedImage } from "@/app/lib/storage";

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

function validationResponse(error: z.ZodError, language: string) {
  const field = String(error.issues[0]?.path[0] ?? "");
  // Hand-written refusals below were made bilingual; these come from the
  // schema and were not, so a Hindi contributor filling a Hindi form was told
  // in English which field to fix.
  const messages: Record<string, Bilingual> = {
    kind: {
      en: "Choose what you are sharing.",
      hi: "आप क्या साझा कर रहे हैं, यह चुनें।",
    },
    title: {
      en: "Title must be between 2 and 120 characters.",
      hi: "शीर्षक 2 से 120 अक्षरों के बीच होना चाहिए।",
    },
    subtitle: {
      en: "Subtitle must be 120 characters or fewer.",
      hi: "उपशीर्षक 120 अक्षरों से अधिक नहीं हो सकता।",
    },
    credit: {
      en: "Name or alias must be 80 characters or fewer.",
      hi: "नाम या उपनाम 80 अक्षरों से अधिक नहीं हो सकता।",
    },
    creditAccount: {
      en: "Enter a handle or profile link without spaces.",
      hi: "बिना जगह वाला हैंडल या प्रोफ़ाइल लिंक डालें।",
    },
    sourceUrl: {
      en: "Link where this was published, starting with https://",
      hi: "यह कहाँ प्रकाशित है उसका लिंक दें, जो https:// से शुरू हो।",
    },
    body: {
      en: "That text is too long.",
      hi: "यह पाठ बहुत लंबा है।",
    },
    consent: {
      en: "Tick the box to confirm the terms.",
      hi: "शर्तें स्वीकार करने के लिए बॉक्स पर निशान लगाएँ।",
    },
  };
  const fallback: Bilingual = {
    en: "Please check every required field.",
    hi: "कृपया हर ज़रूरी जगह भरें।",
  };
  return NextResponse.json(
    { error: say(language, messages[field] ?? fallback), field },
    { status: 400 },
  );
}


function remoteIdentifier(request: NextRequest) {
  // Only headers the hosting platform sets and overwrites can be trusted.
  // CF-Connecting-IP was previously consulted first and taken from the inbound
  // request with no proof the request came through Cloudflare — on this
  // deployment anyone could send it and pick their own bucket, which voided
  // both the upload limit and the lookup limit that protects recovery codes.
  // It is used only when the platform is actually Cloudflare.
  const behindCloudflare = process.env.ART_TRUSTED_PROXY === "cloudflare";
  if (behindCloudflare) {
    const edge = request.headers.get("cf-connecting-ip");
    if (edge) return edge;
  }
  // Otherwise take the LAST X-Forwarded-For element: a proxy appends the peer
  // it actually saw, so trailing entries are the platform's, while anything a
  // caller prepends sits at the front.
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded?.[forwarded.length - 1] || "unknown";
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

export async function POST(request: NextRequest) {
  // Keys of objects this request has put, or is about to. One list, cleaned up
  // in one place, because every failure after the first byte reaches storage
  // has the same consequence: files no row points at. Nothing can reach those.
  // Withdrawal and moderator deletion both work from a row, so an object with
  // no row is kept until someone finds it by hand in the bucket.
  const written: string[] = [];
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

    // A declared length over the cap is refused before a byte is buffered. The
    // file-size check further down runs after the whole multipart body has been
    // read into memory, so on its own it invites exactly the request it exists
    // to stop: send something enormous, have it parsed, have it rejected.
    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "Images must be 4 MB or smaller.", field: "file" },
        { status: 413 },
      );
    }

    // Spent on the attempt to parse, not on the outcome. Everything above is a
    // header check; from here the server commits to reading and decoding a
    // multipart body, and a request that is refused afterwards has still cost
    // that work. Without this, oversized or malformed bodies could be repeated
    // without limit, because they never reach the allowance the submit path
    // spends on success.
    if (!(await consumeRateLimit("contribution-parse", identifier, 60, 60 * 60 * 1000))) {
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
      // Decoding is the expensive part — up to MAX_INPUT_PIXELS of work per
      // request — and until this guard existed nothing was spent before it.
      // A refused image consumed no allowance at all, so the same 4 MB file
      // could be resubmitted without end and each attempt paid for a full
      // decode and re-encode. This allowance is deliberately looser than the
      // one below: it exists to bound work, not to ration submissions, and a
      // visitor fighting a phone camera's output should not exhaust it.
      if (!(await consumeRateLimit("contribution-decode", identifier, 30, 60 * 60 * 1000))) {
        return NextResponse.json(
          { error: say(fields.language, MESSAGES.rateLimited) },
          { status: 429 },
        );
      }
      const input = new Uint8Array(await file.arrayBuffer());
      const processed = await processImage(input);
      // Spent here: after everything that can legitimately fail (format,
      // size, decode), and before the first byte reaches the bucket. Earlier
      // and a refused file cost the visitor an hour having stored nothing;
      // later and a request losing the race left orphaned objects that nothing
      // working from a row could ever reach.
      if (!(await consumeRateLimit("contribution-submit", identifier, 5, 60 * 60 * 1000))) {
        return NextResponse.json(
          { error: say(fields.language, MESSAGES.rateLimited) },
          { status: 429 },
        );
      }
      await putProcessedImage(processed, written);
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

    // Spent before anything is written to the bucket. Uploading first and
    // checking after meant a request that lost the race returned 429 with its
    // two objects already stored and no row to reference them. Every path that
    // deletes an object starts from a row, so that is permanent.
    if (!isFileKind && !(await consumeRateLimit("contribution-submit", identifier, 5, 60 * 60 * 1000))) {
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
    //
    // Past this point the submission exists and the contributor's only copy of
    // their code is in the response we are about to send. A failure to record
    // the audit line must not turn that into an error page, or the row becomes
    // one nobody can withdraw.
    try {
      await writeAuditEvent(null, "submitted", "contribution", id, {
        kind: fields.kind,
        language: fields.language,
      });
    } catch (auditError) {
      console.error("contribution stored but audit line failed", id, auditError);
    }

    return NextResponse.json({ ok: true, recoveryCode: code }, { status: 201 });
  } catch (error) {
    // Nothing below this line stores anything, so reaching here means the
    // submission failed and any object already written belongs to no one.
    await discardStoredObjects(written);
    if (error instanceof z.ZodError) {
      return validationResponse(
        error,
        /\/hi(\/|$)/.test(request.headers.get("referer") ?? "") ? "hi" : "en",
      );
    }
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
