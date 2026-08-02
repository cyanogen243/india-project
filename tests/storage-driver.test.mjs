import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { startTestServer, stopTestServer } from "./helpers/server.mjs";
import sharp from "sharp";
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

async function adminSession() {
  const login = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email: superAdminEmail,
      password: superAdminPassword,
    }),
  });
  assert.equal(login.status, 200, "admin sign-in should succeed");
  const cookie = (login.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
  // The CSRF token rides in the session payload, not a cookie.
  const state = await fetch(`${baseUrl}/api/admin`, { headers: { cookie } });
  const csrfToken = (await state.json())?.user?.csrfToken ?? "";
  return { cookie, csrfToken };
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
  // An open client holds a handle on the database file, which makes removing
  // the directory fail on Windows.
  db?.close();
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

  const { cookie, csrfToken } = await adminSession();

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
  assert.equal(
    print.headers.get("content-length"),
    null,
    "print files stream instead of becoming a size-limited buffered Function response",
  );
  const storedRow = await db.execute({
    sql: "SELECT storage_key FROM contributions WHERE id = ?",
    args: [id],
  });
  const expectedPrint = s3.get(String(storedRow.rows[0].storage_key)).bytes;
  assert.deepEqual(
    Buffer.from(await print.arrayBuffer()),
    Buffer.from(expectedPrint),
    "streaming does not alter the stored print file",
  );
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

test("stored dimensions describe the file that was stored", async () => {
  // A 6000x1000 upload is resized to fit a 5000px edge, so it lands as
  // 5000x833. The row used to record 6000x1000 — the pre-resize size — and the
  // gallery shows that number to visitors as the print size, describing a file
  // that does not exist.
  await resetRateLimits();
  const wide = await sharp({
    create: { width: 6000, height: 1000, channels: 3, background: { r: 20, g: 40, b: 90 } },
  })
    .png()
    .toBuffer();

  const form = new FormData();
  for (const [key, value] of Object.entries({
    kind: "poster",
    title: "S3 Dimension Report",
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
  form.set("file", new Blob([wide], { type: "image/png" }), "wide.png");
  const sent = await fetch(`${baseUrl}/api/contributions`, { method: "POST", body: form });
  assert.equal(sent.status, 201, await sent.text());

  const { rows } = await db.execute({
    sql: "SELECT width, height, byte_size, storage_key FROM contributions WHERE title = ?",
    args: ["S3 Dimension Report"],
  });
  const row = rows[0];

  // What the bucket actually holds, measured rather than assumed.
  const stored = s3.get(String(row.storage_key));
  const actual = await sharp(Buffer.from(stored.bytes)).metadata();

  assert.equal(Number(row.width), actual.width, "recorded width matches the stored file");
  assert.equal(Number(row.height), actual.height, "recorded height matches the stored file");
  assert.ok(actual.width <= 5000, "and the stored file respects the print edge");
  assert.notEqual(Number(row.width), 6000, "the pre-resize width is not what gets recorded");
  assert.equal(
    Number(row.byte_size),
    stored.bytes.byteLength,
    "byte size describes the stored file too",
  );
});

test("a curated upload that fails to store leaves nothing behind either", async () => {
  // Curation stores the same two objects the public form does. The public path
  // was given compensation and this one was not, so the identical failure —
  // print variant accepted, social variant refused — orphaned a file here that
  // no row pointed at and nothing could reach.
  await resetRateLimits();
  const { cookie, csrfToken } = await adminSession();
  const before = new Set(s3.keys());
  s3.failPutsWhere((key) => key.endsWith("-social.jpg"));

  let response;
  try {
    const bytes = await readFile("content/seed-art/poster-stripes.png");
    const form = new FormData();
    for (const [key, value] of Object.entries({
      kind: "poster",
      title: "S3 Curated Half Written",
      subtitle: "",
      credit: "The India Project",
      creditAccount: "",
      body: "",
      language: "en",
      provenance: "own",
      sourceUrl: "",
      status: "approved",
      placeholder: "",
    })) {
      form.set(key, value);
    }
    form.set("file", new Blob([bytes], { type: "image/png" }), "poster.png");
    response = await fetch(`${baseUrl}/api/admin/contributions`, {
      method: "POST",
      headers: { cookie, "x-tip-csrf": csrfToken },
      body: form,
    });
  } finally {
    s3.failPutsWhere(null);
  }

  // The status has to be the one the storage failure produces. Asserting only
  // "not 201" passed for a rejected request that never stored anything, which
  // is how this test came to prove nothing.
  const body = await response.text();
  assert.equal(response.status, 400, `expected a storage failure, got ${response.status}: ${body}`);
  assert.match(body, /Injected failure/, "and specifically the injected put failure");

  const leaked = s3.keys().filter((key) => !before.has(key));
  assert.deepEqual(
    leaked,
    [],
    `a half-finished curation left ${leaked.length} object(s) nothing points at: ${leaked.join(", ")}`,
  );

  const { rows } = await db.execute({
    sql: "SELECT count(*) AS n FROM contributions WHERE title = ?",
    args: ["S3 Curated Half Written"],
  });
  assert.equal(Number(rows[0].n), 0, "and no row was written");
});

test("declining removes the files from the bucket", async () => {
  // A declined poster used to keep both objects. Nothing else deletes them, so
  // they stayed for the life of the database.
  await resetRateLimits();
  const sent = await submitPoster("S3 Declined Poster");
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const { rows } = await db.execute({
    sql: "SELECT id, storage_key, social_storage_key FROM contributions WHERE title = ?",
    args: ["S3 Declined Poster"],
  });
  const row = rows[0];
  const keys = [String(row.storage_key), String(row.social_storage_key)];
  for (const key of keys) {
    assert.ok(s3.keys().includes(key), `${key} is in the bucket before the decline`);
  }

  const { cookie, csrfToken } = await adminSession();
  const declined = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-tip-csrf": csrfToken },
    body: JSON.stringify({
      action: "contribution_update",
      id: String(row.id),
      status: "declined",
      declineReason: "off_topic",
      internalNotes: "out of scope",
    }),
  });
  assert.equal(declined.status, 200);

  for (const key of keys) {
    assert.ok(!s3.keys().includes(key), `${key} is gone from the bucket after the decline`);
  }
  const after = await db.execute({
    sql: "SELECT storage_key, social_storage_key, decline_reason FROM contributions WHERE id = ?",
    args: [String(row.id)],
  });
  assert.equal(after.rows[0].storage_key, null, "and the row no longer points at it");
  assert.equal(after.rows[0].social_storage_key, null);
  assert.equal(after.rows[0].decline_reason, "off_topic", "while the decision survives");
});

test("a decline that cannot remove the files changes nothing and says so", async () => {
  // The row is the only thing that knows these keys. Clearing it after a failed
  // delete leaves a file nothing can find, and tells the moderator the work was
  // erased when it is still stored.
  await resetRateLimits();
  const sent = await submitPoster("S3 Undeletable Poster");
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const { rows } = await db.execute({
    sql: "SELECT id, storage_key, social_storage_key, title FROM contributions WHERE title = ?",
    args: ["S3 Undeletable Poster"],
  });
  const row = rows[0];

  const { cookie, csrfToken } = await adminSession();
  s3.failDeletesWhere(() => true);
  let response;
  try {
    response = await fetch(`${baseUrl}/api/admin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-tip-csrf": csrfToken },
      body: JSON.stringify({
        action: "contribution_update",
        id: String(row.id),
        status: "declined",
        declineReason: "off_topic",
        internalNotes: "out of scope",
      }),
    });
  } finally {
    s3.failDeletesWhere(null);
  }

  assert.equal(response.status, 503, "the moderator is told it did not happen");

  const after = await db.execute({
    sql: "SELECT status, title, storage_key, social_storage_key FROM contributions WHERE id = ?",
    args: [String(row.id)],
  });
  assert.equal(after.rows[0].status, "pending", "the row is untouched");
  assert.equal(after.rows[0].title, row.title, "including its title");
  assert.equal(
    after.rows[0].storage_key,
    row.storage_key,
    "and it still points at the file that is still there",
  );
  assert.ok(s3.keys().includes(String(row.storage_key)), "which is indeed still there");

  // And it succeeds once the bucket cooperates.
  const retry = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-tip-csrf": csrfToken },
    body: JSON.stringify({
      action: "contribution_update",
      id: String(row.id),
      status: "declined",
      declineReason: "off_topic",
      internalNotes: "out of scope",
    }),
  });
  assert.equal(retry.status, 200, "a retry works");
  assert.ok(!s3.keys().includes(String(row.storage_key)), "and the file is gone");
});

test("a withdrawal during moderation is not undone by it", async () => {
  // The moderator's request reads the status, checks it, deletes the objects,
  // and only then writes. A withdrawal arriving inside that window used to be
  // overwritten by a decision made before it existed — putting work back on the
  // wall that its author had just taken down.
  //
  // The delete is the window. Holding it open reproduces the interleaving
  // deterministically instead of hoping two requests collide.
  await resetRateLimits();
  const sent = await submitPoster("S3 Race Poster");
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const code = sent.body.recoveryCode;

  const { rows } = await db.execute({
    sql: "SELECT id FROM contributions WHERE title = ?",
    args: ["S3 Race Poster"],
  });
  const id = String(rows[0].id);

  const { cookie, csrfToken } = await adminSession();
  await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-tip-csrf": csrfToken },
    body: JSON.stringify({
      action: "contribution_update",
      id,
      status: "approved",
      internalNotes: "",
    }),
  });

  // Hold the moderator's first delete open. Deletes are issued one at a time,
  // so holding just one leaves the withdrawal's own deletes unheld — it
  // completes while the decline is still waiting on the bucket.
  s3.delayNextDeletes(1, 700);
  const decline = fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-tip-csrf": csrfToken },
    body: JSON.stringify({
      action: "contribution_update",
      id,
      status: "declined",
      declineReason: "off_topic",
      internalNotes: "declining",
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  const withdrawal = await fetch(`${baseUrl}/api/contributions/lookup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, action: "withdraw" }),
  });
  assert.equal(withdrawal.status, 200, "the contributor's withdrawal lands first");

  const declineResponse = await decline;
  assert.equal(
    declineResponse.status,
    409,
    "and the moderator's write, made before it, is refused",
  );

  const after = await db.execute({
    sql: "SELECT status, title FROM contributions WHERE id = ?",
    args: [id],
  });
  assert.equal(after.rows[0].status, "withdrawn", "the contributor's decision stands");
  assert.equal(after.rows[0].title, "(withdrawn)");
});
