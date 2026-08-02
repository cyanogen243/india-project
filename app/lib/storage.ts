import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ProcessedImage } from "@/app/lib/contributions";

/**
 * Object storage for contribution files.
 *
 * Local development writes to the ignored `data/uploads` directory. Deployed
 * environments use any S3-compatible store — Cloudflare R2 at launch, with a
 * planned move to self-hosted MinIO; both speak the same API, so switching is
 * an environment-variable change. Vercel's filesystem is read-only apart from
 * an ephemeral /tmp, so the disk driver must never run in production.
 *
 * S3 driver activates when these are set:
 *   ART_S3_ENDPOINT   e.g. https://<account>.r2.cloudflarestorage.com
 *   ART_S3_BUCKET
 *   ART_S3_ACCESS_KEY_ID
 *   ART_S3_SECRET_ACCESS_KEY
 *   ART_S3_REGION     defaults to "auto", which only Cloudflare R2 accepts.
 *                     Most providers verify the signing region and reject a
 *                     mismatch with a 403 that reads like bad credentials. The
 *                     right value is the region in the endpoint host — for
 *                     https://s3.eu-west-par.io.cloud.ovh.net that is
 *                     "eu-west-par". `npm run check:storage` catches this.
 */

export type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
};

export type StreamedObject = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
};

const LOCAL_ROOT = resolve("data/uploads");

// Keys are generated server-side and never derived from user input. Validating
// the shape before touching the filesystem keeps traversal out of the path.
const KEY_PATTERN = /^[a-f0-9-]{36}(-social)?\.(png|jpg|webp|pdf)$/;

function assertKey(key: string) {
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key.");
}

function localPath(key: string) {
  const path = join(LOCAL_ROOT, key);
  if (!resolve(path).startsWith(LOCAL_ROOT)) throw new Error("Invalid storage key.");
  return path;
}

function s3Config() {
  const required = {
    ART_S3_ENDPOINT: process.env.ART_S3_ENDPOINT,
    ART_S3_BUCKET: process.env.ART_S3_BUCKET,
    ART_S3_ACCESS_KEY_ID: process.env.ART_S3_ACCESS_KEY_ID,
    ART_S3_SECRET_ACCESS_KEY: process.env.ART_S3_SECRET_ACCESS_KEY,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    // Fail loudly rather than fall back. The disk driver cannot work on a
    // serverless host — the filesystem is discarded between requests — so a
    // silent fallback means uploads that appear to succeed and are gone by the
    // next request, with the database still pointing at them.
    // The escape hatch is explicit and opt-in so it can never be reached by
    // accident: the automated tests exercise a production build with no bucket
    // on purpose. A deployment that sets this has chosen to lose uploads.
    const diskAllowed = process.env.ART_S3_ALLOW_LOCAL_DISK === "yes";
    if (process.env.NODE_ENV === "production" && !diskAllowed) {
      throw new Error(
        `Object storage is not configured: ${missing.join(", ")} must be set. ` +
          "Contribution files cannot be stored on the local filesystem in production. " +
          "Set ART_S3_ALLOW_LOCAL_DISK=yes only if losing them is acceptable.",
      );
    }
    // A partial configuration is a mistake in any environment: it almost
    // always means a typo or a half-copied set of credentials.
    if (missing.length < Object.keys(required).length) {
      throw new Error(
        `Object storage is half configured: ${missing.join(", ")} missing. ` +
          "Set all four ART_S3_* variables, or none to use local disk in development.",
      );
    }
    return null;
  }

  const { ART_S3_ENDPOINT: endpoint, ART_S3_BUCKET: bucket } = required;
  const accessKeyId = required.ART_S3_ACCESS_KEY_ID as string;
  const secretAccessKey = required.ART_S3_SECRET_ACCESS_KEY as string;
  if (!endpoint || !bucket) return null;
  return {
    endpoint,
    bucket,
    region: process.env.ART_S3_REGION ?? "auto",
    credentials: { accessKeyId, secretAccessKey },
  };
}

type S3Module = typeof import("@aws-sdk/client-s3");
let s3ClientPromise:
  | Promise<{ client: InstanceType<S3Module["S3Client"]>; module: S3Module; bucket: string }>
  | undefined;

function getS3() {
  const config = s3Config();
  if (!config) return null;
  if (!s3ClientPromise) {
    s3ClientPromise = import("@aws-sdk/client-s3").then((module) => ({
      module,
      bucket: config.bucket,
      client: new module.S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: config.credentials,
        forcePathStyle: true,
      }),
    }));
  }
  return s3ClientPromise;
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string) {
  assertKey(key);
  const s3 = getS3();
  if (s3) {
    const { client, module, bucket } = await s3;
    await client.send(
      new module.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    return;
  }
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function getObject(key: string): Promise<StoredObject | null> {
  assertKey(key);
  const s3 = getS3();
  if (s3) {
    const { client, module, bucket } = await s3;
    try {
      const result = await client.send(
        new module.GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) return null;
      return { bytes, contentType: result.ContentType ?? contentTypeForKey(key) };
    } catch {
      return null;
    }
  }
  try {
    const bytes = await readFile(localPath(key));
    return { bytes: new Uint8Array(bytes), contentType: contentTypeForKey(key) };
  } catch {
    return null;
  }
}

/**
 * Streams an object to an HTTP response without buffering it into the response
 * payload. Vercel caps buffered Function responses at 4.5 MB, while printable
 * artwork can legitimately be larger. A Web Stream keeps the self-hosted proxy
 * and its privacy/removal guarantees without turning large downloads into 500s.
 */
export async function streamObject(key: string): Promise<StreamedObject | null> {
  assertKey(key);
  const s3 = getS3();
  if (s3) {
    const { client, module, bucket } = await s3;
    try {
      const result = await client.send(
        new module.GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!result.Body) return null;
      return {
        stream: result.Body.transformToWebStream(),
        contentType: result.ContentType ?? contentTypeForKey(key),
      };
    } catch {
      return null;
    }
  }
  try {
    const bytes = new Uint8Array(await readFile(localPath(key)));
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      contentType: contentTypeForKey(key),
    };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  assertKey(key);
  const s3 = getS3();
  if (s3) {
    const { client, module, bucket } = await s3;
    await client.send(new module.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }
  await rm(localPath(key), { force: true });
}

/**
 * Stores both variants of a processed image, recording each key in `written`
 * *before* its write is attempted.
 *
 * The ordering is the point, and it is easy to get backwards. Recording a key
 * only once its put has returned looks safer and is the opposite: a failure on
 * the second write leaves the first object in the bucket while the list the
 * cleanup path reads is still empty. Naming a key that was never written costs
 * a no-op delete; missing one leaves a file no row points at, and every path
 * that deletes an object starts from a row.
 *
 * Three callers store images — the public form, admin curation, and the seed
 * script — so the rule lives here rather than being restated three times.
 */
export async function putProcessedImage(processed: ProcessedImage, written: string[]) {
  written.push(processed.printKey);
  await putObject(processed.printKey, processed.printBytes, processed.mimeType);
  written.push(processed.socialKey);
  await putObject(processed.socialKey, processed.socialBytes, "image/jpeg");
}

/**
 * Removes stored objects, skipping anything that is not a key, and returns the
 * keys it could not remove.
 *
 * Never throws, so one failed delete cannot abandon the rest or the database
 * write a caller is about to make. But it does not hide the failure either: a
 * caller that is about to clear these keys from the row has to know, because
 * once the row forgets a key nothing can find the object again. Erasure that
 * reports success while the file is still stored is the worst of both.
 *
 * Takes raw row values so callers do not each repeat the null check.
 */
export async function discardStoredObjects(keys: unknown[]): Promise<string[]> {
  const failed: string[] = [];
  for (const key of keys) {
    if (typeof key !== "string" || !key) continue;
    try {
      await deleteObject(key);
    } catch (error) {
      console.error("could not remove stored object", key, error);
      failed.push(key);
    }
  }
  return failed;
}

export function contentTypeForKey(key: string) {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
