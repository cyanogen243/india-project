import { randomUUID } from "node:crypto";
import { contentTypeForKey, deleteObject, getObject, putObject } from "../app/lib/storage";

/**
 * Preflight for object storage, run against whatever ART_S3_* values are in the
 * environment. It exercises the same functions the upload route does rather
 * than a hand-rolled S3 call, so a bucket that passes here is a bucket the app
 * can actually use.
 *
 * Run before pointing a deployment at a new bucket:
 *   npm run check:storage
 *
 * Why this exists: `getObject` swallows errors and returns null, which is the
 * right behaviour for a request handler (a missing file is a 404, not a 500)
 * but hides the difference between "no such key" and "your credentials are
 * wrong". This script tells them apart by writing a key first, so a null read
 * afterwards can only mean the store rejected us.
 */

// A one-pixel PNG. Real bytes with a real magic number, so a store that
// inspects or transforms uploads has something valid to work with.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function describeDriver() {
  const endpoint = process.env.ART_S3_ENDPOINT;
  const bucket = process.env.ART_S3_BUCKET;
  if (!endpoint || !bucket) {
    return { s3: false, label: "local disk (data/uploads)" };
  }
  const region = process.env.ART_S3_REGION ?? "auto";
  return { s3: true, label: `S3 · ${endpoint} · bucket ${bucket} · region ${region}` };
}

async function main() {
  const driver = describeDriver();
  console.log(`Driver:   ${driver.label}`);

  if (driver.s3) {
    // OVH, unlike R2, signs with a real region and rejects a mismatch with a
    // generic 403. The region is in the endpoint host, so a disagreement
    // between the two is worth catching before it looks like bad credentials.
    const endpoint = process.env.ART_S3_ENDPOINT ?? "";
    const region = process.env.ART_S3_REGION ?? "auto";
    const hostRegion = /^https?:\/\/s3\.([a-z0-9-]+)\./i.exec(endpoint)?.[1];
    if (hostRegion && region !== hostRegion) {
      console.warn(
        `Warning:  endpoint host names region "${hostRegion}" but ART_S3_REGION is "${region}". ` +
          "Providers that verify the signing region will reject this as a 403.",
      );
    }
  }

  // The upload route only ever generates keys of this shape, and the storage
  // layer rejects anything else, so the check has to use one too.
  const key = `${randomUUID()}.png`;
  const contentType = contentTypeForKey(key);
  console.log(`Key:      ${key}`);

  console.log("\n1. put");
  await putObject(key, new Uint8Array(PIXEL), contentType);
  console.log("   wrote", PIXEL.byteLength, "bytes as", contentType);

  console.log("2. get");
  const stored = await getObject(key);
  if (!stored) {
    throw new Error(
      "Wrote the object but could not read it back. The write reported success, so " +
        "this is usually a bucket policy that permits PutObject but not GetObject, " +
        "or a region or endpoint mismatch that only the read path notices.",
    );
  }
  if (stored.bytes.byteLength !== PIXEL.byteLength) {
    throw new Error(
      `Read back ${stored.bytes.byteLength} bytes, expected ${PIXEL.byteLength}. ` +
        "The store is altering uploads.",
    );
  }
  if (!Buffer.from(stored.bytes).equals(PIXEL)) {
    throw new Error("Read back the right number of bytes, but not the same bytes.");
  }
  console.log("   read back", stored.bytes.byteLength, "bytes as", stored.contentType);
  if (stored.contentType !== contentType) {
    // Not fatal: the app falls back to deriving the type from the key, and the
    // file route sets its own header. Worth knowing about all the same.
    console.warn(`   note: store returned "${stored.contentType}", not "${contentType}"`);
  }

  console.log("3. delete");
  await deleteObject(key);
  const afterDelete = await getObject(key);
  if (afterDelete) {
    throw new Error(
      "The object survived deletion. Contributor withdrawal and moderator " +
        "deletion both depend on this working, so the bucket is not safe to " +
        "use yet.",
    );
  }
  console.log("   gone");

  console.log("\nStorage is usable: put, get, and delete all behave as the app expects.");
}

main().catch((error) => {
  console.error("\nStorage check failed.\n");
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.cause) console.error("Cause:", error.cause);
  process.exitCode = 1;
});
