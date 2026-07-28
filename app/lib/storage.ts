import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Object storage for contribution files.
 *
 * Local development writes to the ignored `data/uploads` directory. Vercel's
 * filesystem is read-only apart from an ephemeral `/tmp`, so deployed
 * environments must use a blob driver instead. Selecting the driver here keeps
 * the calling code identical in both places.
 */

export type StoredObject = {
  bytes: Uint8Array;
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

function blobDriverEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string) {
  assertKey(key);
  if (blobDriverEnabled()) {
    throw new Error(
      "Blob storage driver is not wired yet. Install @vercel/blob and implement putObject before deploying.",
    );
  }
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  void contentType;
}

export async function getObject(key: string): Promise<StoredObject | null> {
  assertKey(key);
  if (blobDriverEnabled()) {
    throw new Error(
      "Blob storage driver is not wired yet. Install @vercel/blob and implement getObject before deploying.",
    );
  }
  try {
    const bytes = await readFile(localPath(key));
    return { bytes: new Uint8Array(bytes), contentType: contentTypeForKey(key) };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  assertKey(key);
  if (blobDriverEnabled()) {
    throw new Error(
      "Blob storage driver is not wired yet. Install @vercel/blob and implement deleteObject before deploying.",
    );
  }
  await rm(localPath(key), { force: true });
}

export function contentTypeForKey(key: string) {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
