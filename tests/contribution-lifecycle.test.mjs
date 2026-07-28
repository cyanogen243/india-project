import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
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

// The route consumes the 5-per-hour limit on every request, deliberately
// before the body is parsed. Each scenario below is a separate visitor, so the
// counter is reset rather than making the tests share one visitor's budget.
beforeEach(async () => {
  if (db) await db.execute("DELETE FROM rate_limits");
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
  // Not `immutable`: a withdrawn file has to stop being served to people who
  // already loaded it, which an immutable entry would prevent for a year.
  const cacheControl = published.headers.get("cache-control") ?? "";
  assert.match(cacheControl, /must-revalidate/);
  assert.doesNotMatch(cacheControl, /immutable/);
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

test("public-domain writing is attributed to its author, not licensed as ours", async () => {
  const title = "Test Public Domain Poem";
  const sent = await submit({
    kind: "poem",
    title,
    body: "An old verse nobody alive wrote.",
    credit: "Kabir",
    provenance: "public_domain",
    sourceUrl: "https://kavitakosh.org/kk/example",
  });
  assert.equal(sent.status, 201);

  const row = await rowByTitle(title);
  assert.equal(row.provenance, "public_domain");
  assert.equal(row.source_url, "https://kavitakosh.org/kk/example");

  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });

  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.match(wall, /Public domain/, "the tile states its own terms");
  assert.doesNotMatch(
    wall,
    /Everything is free · non-commercial use · CC BY-NC-SA 4\.0/,
    "the wall no longer claims one licence covers everything",
  );

  const page = await (await fetch(`${baseUrl}/art/${row.id}`)).text();
  assert.match(page, /Public domain/);
  assert.match(page, /kavitakosh\.org/, "the read page links the source for verification");
});

test("a public-domain claim has to be checkable, and only applies to writing", async () => {
  const noSource = await submit({
    kind: "poem",
    title: "No Source Given",
    body: "Text without any provenance link.",
    credit: "Someone Old",
    provenance: "public_domain",
  });
  assert.equal(noSource.status, 400, "a source link is required");

  const noAuthor = await submit({
    kind: "poem",
    title: "No Author Given",
    body: "Text without an author.",
    provenance: "public_domain",
    sourceUrl: "https://example.org/text",
  });
  assert.equal(noAuthor.status, 400, "the original author is required");

  const bytes = await readFile("content/seed-art/poster-peaks.png");
  const poster = await submit(
    {
      kind: "poster",
      title: "Public Domain Poster",
      credit: "Someone Old",
      provenance: "public_domain",
      sourceUrl: "https://example.org/poster",
    },
    { bytes, type: "image/png", name: "poster.png" },
  );
  assert.equal(poster.status, 400, "posters and images go through admin curation instead");
});

test("a withdrawn upload cannot be published again", async () => {
  const title = "Test Republish Guard";
  const bytes = await readFile("content/seed-art/poster-rays.png");
  const sent = await submit({ kind: "image", title }, { bytes, type: "image/png", name: "p.png" });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();

  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });
  assert.equal((await lookup(sent.body.recoveryCode, "withdraw")).status, 200);

  const republish = await moderate(session, {
    id: String(row.id),
    status: "approved",
    internalNotes: "",
  });
  assert.equal(republish.status, 409, "its files are gone, so approving again is refused");

  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.doesNotMatch(wall, new RegExp(title), "withdrawn work stays off the wall");
});

test("a clock running ahead does not silently discard the work", async () => {
  const form = humanTimings(new FormData());
  form.set("kind", "poem");
  form.set("title", "Test Fast Clock");
  form.set("body", "Submitted from a device whose clock runs ahead.");
  // A device two minutes ahead of the server reports a negative elapsed time.
  form.set("startedAt", String(Date.now() + 120_000));
  const response = await fetch(`${baseUrl}/api/contributions`, { method: "POST", body: form });
  assert.equal(response.status, 201, "clock skew is not treated as bot behaviour");
  const body = await response.json();
  assert.match(String(body.recoveryCode), /^[A-Z0-9]{8}$/, "a real code is still issued");
  assert.ok(await rowByTitle("Test Fast Clock"), "and the work is stored");
});

test("the sweep also clears expired rate-limit rows", async () => {
  await db.execute({
    sql: `INSERT INTO rate_limits (key_hash, action, count, window_started_at, expires_at)
          VALUES ('test-expired-key', 'contribution-submit', 3, ?, ?)`,
    args: ["2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z"],
  });
  const sweep = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/purge-expired.ts"],
    { encoding: "utf8", env: { ...process.env, LIBSQL_URL: `file:${testDbPath}` } },
  );
  assert.equal(sweep.status, 0, sweep.stderr || sweep.stdout);
  const left = await db.execute({
    sql: "SELECT count(*) AS total FROM rate_limits WHERE key_hash = 'test-expired-key'",
  });
  assert.equal(
    Number(left.rows[0].total),
    0,
    "IP-derived rows do not outlive the window they enforce",
  );
});
