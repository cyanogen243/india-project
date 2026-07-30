import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Recovery codes are the only way a contributor returns to a submission. They
 * replace an account, so nothing identifying is stored alongside them.
 *
 * The alphabet omits characters that are easy to confuse when a code is written
 * on paper and typed back in: I, L, O, 0 and 1.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateRecoveryCode() {
  // 31 does not divide 256 evenly, so bytes at or above the largest usable
  // multiple are rejected rather than folded in, which would bias the result.
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= limit) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

export function normalizeRecoveryCode(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Codes carry ~40 bits of entropy and are generated server-side, so a fast
 * digest is appropriate here. A slow KDF guards low-entropy human passwords;
 * this is a random bearer token, matching how `sessions.token_hash` is stored.
 */
export function hashRecoveryCode(code: string) {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

export function recoveryCodeMatches(candidate: string, storedHash: string) {
  const a = Buffer.from(hashRecoveryCode(candidate), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Ceiling for the whole multipart body, checked against Content-Length before
 * anything is buffered. Larger than the file cap because the body also carries
 * the form fields and multipart framing, so a 4 MB image legitimately arrives
 * as slightly more than 4 MB.
 */
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 512 * 1024;

/**
 * Everything a contribution loses when it stops being publishable.
 *
 * Set by both paths that end a submission — a contributor withdrawing their
 * work, and a moderator declining it — so the two cannot disagree about what
 * erasing means.
 *
 * The row survives: a recovery code still reports the outcome, and the decision
 * stays auditable. What it keeps is the decision — status, reason, reviewer.
 * What it loses is the work.
 *
 * The title is the caller's, since "(withdrawn)" and "(declined)" are different
 * facts. So is `internal_notes`: a decline arrives with the moderator's note in
 * the same request.
 */
export const ERASED_CONTRIBUTION_COLUMNS = `storage_key = NULL, social_storage_key = NULL,
  body = '', subtitle = '', credit = '', credit_account = '', source_url = '',
  content_fingerprint = NULL`;

/**
 * A poem at or under this length is shown in full on its tile; a longer one is
 * cut here and hands off to its read page. Essays always show only title and
 * subtitle on the wall. The essay ceiling accommodates seeded historical
 * texts — Bhagat Singh's letter alone is ~23,000 characters.
 */
export const POEM_TILE_LIMIT = 600;
export const POEM_MAX_LENGTH = 8000;
export const ESSAY_MAX_LENGTH = 40000;

/**
 * A few kilobytes of PNG can declare enormous dimensions and expand to
 * gigabytes once decoded — a decompression bomb. The byte-size cap does not
 * catch that, because the file on the wire is genuinely small. This does.
 * 50 megapixels is far beyond any poster and well under the memory a
 * serverless function has.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Fingerprints the re-encoded bytes so the same artwork resubmitted repeatedly
 * is visible to moderators. Hashing after processing rather than before means
 * trivial metadata edits do not produce a different fingerprint.
 */
export function contentFingerprint(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Longest edge of the stored print variant. A3 at 300dpi is 4961px, A4 is
// 3508px, so this keeps a poster printable at A3 — the largest size anyone
// runs off at a copy shop — without storing more than a printer can use.
// Anything larger is downscaled rather than refused.
const PRINT_MAX_EDGE = 5000;

// A backstop, not the real control: format-appropriate encoding below keeps a
// flat-colour poster around 1-3 MB and a photograph around 4-8 MB at this
// resolution. Only a pathological input reaches this.
const MAX_STORED_BYTES = 25 * 1024 * 1024;

const SOCIAL_WIDTH = 1080;
const SOCIAL_HEIGHT = 1350;

type DetectedFormat = "png" | "jpeg" | "webp";

/**
 * Trusts the bytes rather than the declared Content-Type, which is entirely
 * attacker-controlled. SVG is deliberately absent: it is a script execution
 * vector, not an image format.
 */
export function detectImageFormat(bytes: Uint8Array): DetectedFormat | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export type ProcessedImage = {
  id: string;
  printKey: string;
  socialKey: string;
  printBytes: Uint8Array;
  socialBytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
};

/**
 * Re-encodes every upload from raw pixels. This is what strips embedded author
 * metadata: design tools write creator names into XMP, and phone cameras write
 * EXIF including GPS. Rebuilding the file discards all of it, and also disposes
 * of any payload hidden in a container the original format allowed.
 *
 * `rotate()` with no argument bakes in the EXIF orientation before that tag is
 * discarded, so stripped images do not come out sideways.
 */
export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  const format = detectImageFormat(input);
  if (!format) {
    throw new Error("Only PNG, JPEG and WebP images are accepted.");
  }

  // Loaded here rather than at module scope. sharp is a native binding, and
  // this module is also imported for its recovery-code helpers and its size
  // constants by routes that never touch an image — including in the Sites
  // build, which targets a Worker runtime with no native modules. A top-level
  // import put sharp's loader into that bundle and took the whole worker down
  // on import, so text contributions and every unrelated route failed too.
  // Now only an actual image upload reaches it.
  const sharp = (await import("sharp")).default;

  const source = sharp(Buffer.from(input), { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS });
  const metadata = await source.metadata();
  // Only a readability check: a file whose header declares no usable size is
  // refused here rather than part-way through encoding. The dimensions that get
  // recorded come from the encoded print variant further down, since that is
  // the file the number will describe.
  const oriented = metadata.autoOrient ?? { width: metadata.width, height: metadata.height };
  if (!oriented.width || !oriented.height) {
    throw new Error("That image could not be read.");
  }

  // Bounded on the way out, not just on the way in. A 3 MB upload of a 49 MP
  // image re-encodes to a ~76 MB lossless PNG — 24x amplification — and every
  // one of those sits in the bucket. Print work does not need more than this
  // edge: 3000px is a 25cm print at 300dpi, comfortably past what the wall or
  // a home printer uses.
  // The print variant keeps the source's family rather than always writing
  // PNG. Flat-colour poster art compresses to a fraction of its size as PNG
  // and stays razor sharp; a photograph as lossless PNG is many times larger
  // than the JPEG it came from for no visible gain. Matching the format to
  // the material is what makes a generous print resolution affordable.
  const printIsPhotographic = format !== "png";
  const printPipeline = sharp(Buffer.from(input), {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .rotate()
    .resize(PRINT_MAX_EDGE, PRINT_MAX_EDGE, { fit: "inside", withoutEnlargement: true });
  // `resolveWithObject` so the dimensions come from what was actually encoded.
  // Reporting the pre-resize size meant a 6000x1000 upload was stored as
  // 5000x833 and recorded as 6000x1000 — a number shown to visitors as the
  // print size, describing a file that does not exist.
  const printResult = await (printIsPhotographic
    ? printPipeline.jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    : printPipeline.png({ compressionLevel: 9 })
  ).toBuffer({ resolveWithObject: true });
  const printBytes = new Uint8Array(printResult.data);
  if (printBytes.byteLength > MAX_STORED_BYTES) {
    throw new Error("Only PNG, JPEG and WebP images are accepted.");
  }

  const socialBytes = new Uint8Array(
    await sharp(Buffer.from(input), { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(SOCIAL_WIDTH, SOCIAL_HEIGHT, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer(),
  );

  const id = randomUUID();
  return {
    id,
    // The key carries the real format: the file route derives Content-Type
    // from the key, so a JPEG stored under a .png key would be served as PNG.
    printKey: `${id}.${printIsPhotographic ? "jpg" : "png"}`,
    socialKey: `${id}-social.jpg`,
    printBytes,
    socialBytes,
    mimeType: printIsPhotographic ? "image/jpeg" : "image/png",
    width: printResult.info.width,
    height: printResult.info.height,
  };
}
