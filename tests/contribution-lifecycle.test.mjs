import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createClient } from "@libsql/client";

/**
 * Covers the contribution wall end to end against a real server and a
 * throwaway database: submit, moderate, and the access rules that decide what
 * a visitor may see at each status. With ART_S3_* unset the storage driver
 * falls back to the ignored data/uploads directory, so no bucket is needed.
 */

let server;
let baseUrl;
let testDbDir;
let testDbPath;
let db;
const superAdminEmail = "owner@example.test";
const superAdminPassword = "LocalReviewPassword!2026";

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next.js production server did not start");
}

// The route rejects anything submitted faster than a human could type, so a
// test submission has to claim a plausible start time.
function humanTimings(form) {
  form.set("startedAt", String(Date.now() - 30_000));
  form.set("website", "");
  form.set("consent", "yes");
  form.set("language", "en");
  return form;
}

async function submit(fields, file) {
  const form = humanTimings(new FormData());
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file) {
    form.set("file", new Blob([file.bytes], { type: file.type }), file.name);
  }
  const response = await fetch(`${baseUrl}/api/contributions`, {
    method: "POST",
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function lookup(code, action = "status") {
  const response = await fetch(`${baseUrl}/api/contributions/lookup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, action }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function adminSession() {
  const response = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email: superAdminEmail,
      password: superAdminPassword,
    }),
  });
  assert.equal(response.status, 200, "admin sign-in should succeed");
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
  // The CSRF token rides in the session payload, not a cookie.
  const state = await fetch(`${baseUrl}/api/admin`, { headers: { cookie } });
  const csrfToken = (await state.json())?.user?.csrfToken ?? "";
  return { cookie, csrfToken };
}

async function moderate(session, payload) {
  const response = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: session.cookie,
      "x-tip-csrf": session.csrfToken,
    },
    body: JSON.stringify({ action: "contribution_update", ...payload }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

// The row is the fastest way to learn the id a contributor is never given
// while their work is pending.
async function rowByTitle(title) {
  const result = await db.execute({
    sql: "SELECT * FROM contributions WHERE title = ?",
    args: [title],
  });
  return result.rows[0];
}

before(async () => {
  testDbDir = await mkdtemp(path.join(tmpdir(), "tip-contrib-"));
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
  };
  delete testEnv.ART_S3_ENDPOINT;
  delete testEnv.ART_S3_BUCKET;
  delete testEnv.ART_S3_ACCESS_KEY_ID;
  delete testEnv.ART_S3_SECRET_ACCESS_KEY;

  const bootstrap = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/bootstrap-admin.ts"],
    { env: testEnv, encoding: "utf8" },
  );
  assert.equal(bootstrap.status, 0, bootstrap.stderr || bootstrap.stdout);

  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    { stdio: "ignore", env: testEnv },
  );
  await waitForServer(baseUrl);
  db = createClient({ url: `file:${testDbPath}` });
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await exited;
  }
  if (testDbDir) await rm(testDbDir, { recursive: true, force: true });
});

test("a poem stays private until it is approved, then gets its own page", async () => {
  const title = "Test Poem For Review";
  const sent = await submit({
    kind: "poem",
    title,
    body: "A first line for the wall.\nAnd a second line beneath it.",
    credit: "Test Contributor",
  });
  assert.equal(sent.status, 201, "a stored submission reports created");
  const code = sent.body?.recoveryCode;
  assert.match(String(code), /^[A-Z0-9]{8}$/, "a recovery code is issued");

  const wallWhilePending = await (await fetch(`${baseUrl}/art`)).text();
  assert.doesNotMatch(wallWhilePending, new RegExp(title), "pending work is not on the wall");

  const pending = await lookup(code);
  assert.equal(pending.body?.submission?.status, "pending");
  assert.equal(pending.body?.submission?.id, null, "a pending id is never handed out");

  const row = await rowByTitle(title);
  const session = await adminSession();
  const approved = await moderate(session, {
    id: String(row.id),
    status: "approved",
    internalNotes: "moderator eyes only",
  });
  assert.equal(approved.status, 200);

  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.match(wall, new RegExp(title), "approved work reaches the wall");

  const after = await lookup(code);
  assert.equal(after.body?.submission?.status, "approved");
  assert.equal(after.body?.submission?.id, String(row.id), "approved work is linkable");
  assert.doesNotMatch(
    JSON.stringify(after.body),
    /moderator eyes only/,
    "internal notes never reach the contributor",
  );

  for (const prefix of ["/art", "/hi/art"]) {
    const page = await fetch(`${baseUrl}${prefix}/${row.id}`);
    assert.equal(page.status, 200, `${prefix} read page serves the approved poem`);
  }
});

test("declining tells the contributor why, and only why", async () => {
  const title = "Test Poem For Decline";
  const sent = await submit({ kind: "poem", title, body: "Something out of scope entirely." });
  const code = sent.body?.recoveryCode;
  const row = await rowByTitle(title);
  const session = await adminSession();

  const missingReason = await moderate(session, {
    id: String(row.id),
    status: "declined",
    internalNotes: "",
  });
  assert.equal(missingReason.status, 400, "a decline without a reason is refused");

  const declined = await moderate(session, {
    id: String(row.id),
    status: "declined",
    declineReason: "off_topic",
    internalNotes: "private rationale",
  });
  assert.equal(declined.status, 200);

  const seen = await lookup(code);
  assert.equal(seen.body?.submission?.status, "declined");
  assert.equal(seen.body?.submission?.declineReason, "off_topic");
  assert.equal(seen.body?.submission?.id, null, "declined work is not linkable");
  assert.doesNotMatch(JSON.stringify(seen.body), /private rationale/);

  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.doesNotMatch(wall, new RegExp(title));
});

test("an uploaded image is private while pending and deleted on withdrawal", async () => {
  const title = "Test Image Lifecycle";
  const bytes = await readFile("content/seed-art/poster-sunrise.png");
  const sent = await submit({ kind: "image", title, credit: "Test" }, {
    bytes,
    type: "image/png",
    name: "poster.png",
  });
  assert.equal(sent.status, 201, "a stored submission reports created");
  const code = sent.body?.recoveryCode;
  const row = await rowByTitle(title);

  const whilePending = await fetch(`${baseUrl}/api/contributions/${row.id}/file`);
  assert.equal(whilePending.status, 404, "a pending file is invisible to the public");

  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });

  const published = await fetch(`${baseUrl}/api/contributions/${row.id}/file?variant=social`);
  assert.equal(published.status, 200);
  assert.match(published.headers.get("cache-control") ?? "", /immutable/);
  assert.match(published.headers.get("content-type") ?? "", /^image\//);

  const withdrawn = await lookup(code, "withdraw");
  assert.equal(withdrawn.status, 200);

  const afterWithdrawal = await fetch(`${baseUrl}/api/contributions/${row.id}/file?variant=social`);
  assert.equal(afterWithdrawal.status, 404, "withdrawn files stop being served");

  const cleared = await rowByTitle(title);
  assert.equal(cleared.storage_key, null, "withdrawal clears the stored keys");
  assert.equal(cleared.social_storage_key, null);

  const repeated = await lookup(code, "withdraw");
  assert.equal(repeated.status, 409, "withdrawing twice is refused");
});

test("the upload pipeline refuses what it cannot vouch for", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const disguised = await submit({ kind: "image", title: "Disguised SVG" }, {
    bytes: svg,
    type: "image/png",
    name: "looks-fine.png",
  });
  assert.ok(disguised.status >= 400, "format comes from magic bytes, not the filename");

  const instant = new FormData();
  humanTimings(instant);
  instant.set("kind", "poem");
  instant.set("title", "Straight Through");
  instant.set("body", "Submitted without pausing to type.");
  instant.set("startedAt", String(Date.now()));
  const trapped = await fetch(`${baseUrl}/api/contributions`, { method: "POST", body: instant });
  assert.equal(trapped.status, 202, "an instant submission is accepted silently, not stored");

  const honeypot = new FormData();
  humanTimings(honeypot);
  honeypot.set("kind", "poem");
  honeypot.set("title", "Honeypot Filled");
  honeypot.set("body", "A bot filled the hidden field.");
  honeypot.set("website", "http://spam.example");
  const caught = await fetch(`${baseUrl}/api/contributions`, { method: "POST", body: honeypot });
  assert.ok(caught.status >= 400, "the honeypot field rejects the submission");

  assert.equal((await lookup("ZZZZZZZZ")).status, 404, "an unknown code reveals nothing");

  const unauthenticated = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "contribution_update", id: crypto.randomUUID(), status: "approved" }),
  });
  assert.ok(
    unauthenticated.status === 401 || unauthenticated.status === 403,
    "moderation requires a session",
  );
});

test("the retention sweep clears files once their date has passed", async () => {
  const title = "Test Image For Retention";
  const bytes = await readFile("content/seed-art/poster-stripes.png");
  await submit({ kind: "image", title }, { bytes, type: "image/png", name: "poster.png" });
  const row = await rowByTitle(title);
  const session = await adminSession();
  await moderate(session, {
    id: String(row.id),
    status: "declined",
    declineReason: "off_topic",
    internalNotes: "",
  });

  const declined = await rowByTitle(title);
  assert.ok(declined.storage_key, "a declined upload keeps its file until retention expires");
  assert.ok(declined.retention_eligible_at, "declining stamps a retention date");

  // Move the date into the past rather than waiting 180 days for it.
  await db.execute({
    sql: "UPDATE contributions SET retention_eligible_at = ? WHERE id = ?",
    args: ["2020-01-01T00:00:00.000Z", declined.id],
  });

  const sweep = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/purge-expired.ts"],
    {
      encoding: "utf8",
      env: { ...process.env, LIBSQL_URL: `file:${testDbPath}` },
    },
  );
  assert.equal(sweep.status, 0, sweep.stderr || sweep.stdout);

  const purged = await rowByTitle(title);
  assert.equal(purged.storage_key, null, "the sweep removes the stored file");
  assert.equal(purged.social_storage_key, null);
  assert.equal(purged.status, "declined", "the row survives so the code still reports the outcome");
});
