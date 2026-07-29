import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { startTestServer, stopTestServer } from "./helpers/server.mjs";
import { startMockS3 } from "./helpers/mock-s3.mjs";

/**
 * The contribution wall against an S3 bucket rather than the local disk.
 *
 * Every deployment uses the S3 driver, and until this file existed no test
 * ever ran it: the rest of the suite falls back to `data/uploads`. That left
 * the driver's own behaviour unverified, and made the compensation path
 * untestable — local writes cannot be made to fail for the second variant
 * only, which is precisely the case that once orphaned a file nothing pointed
 * at.
 */

let server;
let baseUrl;
let testDbDir;
let testDbPath;
let db;
let s3;
const superAdminEmail = "owner@example.test";
const superAdminPassword = "LocalReviewPassword!2026";


async function submitPoster(title) {
  const bytes = await readFile("content/seed-art/poster-stripes.png");
  const form = new FormData();
  for (const [key, value] of Object.entries({
    kind: "poster",
    title,
    subtitle: "",
    credit: "",
    creditAccount: "",
    body: "",
    language: "en",
    consent: "yes",
    website: "",
    provenance: "own",
    sourceUrl: "",
    startedAt: String(Date.now() - 30_000),
  })) {
    form.set(key, value);
  }
  form.set("file", new Blob([bytes], { type: "image/png" }), "poster.png");
  const response = await fetch(`${baseUrl}/api/contributions`, {
    method: "POST",
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function resetRateLimits() {
  await db.execute("DELETE FROM rate_limits");
}

before(async () => {
  s3 = await startMockS3();
  testDbDir = await mkdtemp(path.join(tmpdir(), "tip-s3-"));
  testDbPath = path.join(testDbDir, "app.db").replaceAll("\\", "/");
  const { privateKey } = generateKeyPairSync("ed25519");
  const testEnv = {
    ...process.env,
    LIBSQL_URL: `file:${testDbPath}`,
    ADMIN_BOOTSTRAP_EMAIL: superAdminEmail,
    ADMIN_BOOTSTRAP_NAME: "Local Owner",
    ADMIN_BOOTSTRAP_PASSWORD: superAdminPassword,
    SESSION_SECRET: "test-session-secret-not-for-production",
    RATE_LIMIT_SECRET: "test-rate-limit-secret-not-for-production",
    FEED_SIGNING_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    // The point of this file: the S3 driver, not the disk fallback.
    ART_S3_ENDPOINT: s3.endpoint,
    ART_S3_BUCKET: s3.bucket,
    ART_S3_ACCESS_KEY_ID: "test-access-key",
    ART_S3_SECRET_ACCESS_KEY: "test-secret-key",
    ART_S3_REGION: "us-east-1",
    ART_S3_ALLOW_LOCAL_DISK: "",
  };
  ({ server, baseUrl } = await startTestServer(testEnv));
  db = createClient({ url: `file:${testDbPath}` });
});

after(async () => {
  await stopTestServer(server);
  await s3?.close();
  if (testDbDir) await rm(testDbDir, { recursive: true, force: true });
});

test("an upload reaches the bucket, and both variants are stored", async () => {
  await resetRateLimits();
  const sent = await submitPoster("S3 Driver Poster");
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const { rows } = await db.execute({
    sql: "SELECT storage_key, social_storage_key FROM contributions WHERE title = ?",
    args: ["S3 Driver Poster"],
  });
  const row = rows[0];
  assert.ok(row.storage_key, "the row records a print key");
  assert.ok(row.social_storage_key, "and a social key");

  const keys = s3.keys();
  assert.ok(keys.includes(String(row.storage_key)), "the print variant is in the bucket");
  assert.ok(keys.includes(String(row.social_storage_key)), "so is the social variant");
  assert.equal(
    s3.get(String(row.storage_key)).contentType,
    "image/png",
    "stored under the type it actually is",
  );
  assert.equal(s3.get(String(row.social_storage_key)).contentType, "image/jpeg");
});

test("a put that fails partway leaves nothing behind in the bucket", async () => {
  // The failure the compensation exists for: the print variant is accepted and
  // the social one is refused. Before the fix the first object stayed in the
  // bucket with no row pointing at it — unreachable by withdrawal, by the
  // retention sweep, and by any moderator.
  await resetRateLimits();
  const before = new Set(s3.keys());
  s3.failPutsWhere((key) => key.endsWith("-social.jpg"));

  let sent;
  try {
    sent = await submitPoster("S3 Half Written Poster");
  } finally {
    s3.failPutsWhere(null);
  }

  assert.notEqual(sent.status, 201, "the submission must not report success");

  const leaked = s3.keys().filter((key) => !before.has(key));
  assert.deepEqual(
    leaked,
    [],
    `a half-finished upload left ${leaked.length} object(s) nothing points at: ${leaked.join(", ")}`,
  );

  const { rows } = await db.execute({
    sql: "SELECT count(*) AS n FROM contributions WHERE title = ?",
    args: ["S3 Half Written Poster"],
  });
  assert.equal(Number(rows[0].n), 0, "and no row was written");
});

test("an approved upload is served back out of the bucket", async () => {
  await resetRateLimits();
  const { rows } = await db.execute({
    sql: "SELECT id FROM contributions WHERE title = ?",
    args: ["S3 Driver Poster"],
  });
  const id = String(rows[0].id);

  const login = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email: superAdminEmail,
      password: superAdminPassword,
    }),
  });
  const cookie = (login.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
  const state = await fetch(`${baseUrl}/api/admin`, { headers: { cookie } });
  const csrfToken = (await state.json())?.user?.csrfToken ?? "";

  const pending = await fetch(`${baseUrl}/api/contributions/${id}/file`);
  assert.equal(pending.status, 404, "an unreviewed upload is not served");

  const approved = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-tip-csrf": csrfToken },
    body: JSON.stringify({
      action: "contribution_update",
      id,
      status: "approved",
      internalNotes: "",
    }),
  });
  assert.equal(approved.status, 200);

  const print = await fetch(`${baseUrl}/api/contributions/${id}/file`);
  assert.equal(print.status, 200, "the print variant serves from the bucket");
  assert.equal(print.headers.get("content-type"), "image/png");
  const social = await fetch(`${baseUrl}/api/contributions/${id}/file?variant=social`);
  assert.equal(social.status, 200, "and so does the social variant");
  assert.equal(social.headers.get("content-type"), "image/jpeg");

  // Deleting through the admin path must clear the bucket, not just the row.
  const deleted = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-tip-csrf": csrfToken },
    body: JSON.stringify({ action: "contribution_delete", id }),
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(s3.keys(), [], "the bucket is empty once the record is gone");
});
