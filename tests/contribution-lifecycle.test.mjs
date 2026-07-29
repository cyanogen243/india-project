import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { NO_BUCKET_ENV, startTestServer, stopTestServer } from "./helpers/server.mjs";

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
    // These run against a production build with no bucket on purpose; the
    // driver refuses that combination unless it is asked for explicitly.
    ART_S3_ALLOW_LOCAL_DISK: "yes",
    ...NO_BUCKET_ENV,
  };

  ({ server, baseUrl } = await startTestServer(testEnv));
  db = createClient({ url: `file:${testDbPath}` });
});

after(async () => {
  await stopTestServer(server);
  // Before the directory goes: an open client keeps a handle on the database
  // file, which makes the removal fail on Windows.
  db?.close();
  if (testDbDir) await rm(testDbDir, { recursive: true, force: true });
});

// The route consumes the 5-per-hour limit on every request, deliberately
// before the body is parsed. Each scenario below is a separate visitor, so the
// counter is reset rather than making the tests share one visitor's budget.
async function resetRateLimits() {
  if (db) await db.execute("DELETE FROM rate_limits");
}

beforeEach(resetRateLimits);

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

  const cleared = await db.execute({
    sql: "SELECT storage_key, social_storage_key FROM contributions WHERE id = ?",
    args: [String(row.id)],
  });
  assert.equal(cleared.rows[0].storage_key, null, "withdrawal clears the stored keys");
  assert.equal(cleared.rows[0].social_storage_key, null);

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

  // Licence names are clutter on the wall itself: writing carries its terms on
  // its own page, and a poster or image shows them in the lightbox.
  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.doesNotMatch(wall, /CC BY-NC-SA 4\.0/, "no licence names clutter the tiles");
  assert.doesNotMatch(
    wall,
    /Everything is free · non-commercial use · CC BY-NC-SA 4\.0/,
    "the wall no longer claims one licence covers everything",
  );

  const page = await (await fetch(`${baseUrl}/art/${row.id}`)).text();
  assert.match(page, /Public domain/, "the read page states the work's own terms");
  assert.match(page, /kavitakosh\.org/, "and links the source for verification");
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

// Curation is a separate write path from public submission, and it is how
// public-domain photographs reach the wall.
async function addDirectly(session, fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file) form.set("file", new Blob([file.bytes], { type: file.type }), file.name);
  const response = await fetch(`${baseUrl}/api/admin/contributions`, {
    method: "POST",
    headers: { cookie: session.cookie, "x-tip-csrf": session.csrfToken },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

test("an admin can curate a public-domain photograph straight onto the wall", async () => {
  const session = await adminSession();
  const title = "Test Curated Photograph";
  const bytes = await readFile("content/seed-art/image-march-to-dandi.jpg");
  const added = await addDirectly(
    session,
    {
      kind: "image",
      title,
      subtitle: "",
      credit: "Unknown photographer",
      creditAccount: "",
      provenance: "public_domain",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      body: "",
      language: "en",
      status: "approved",
    },
    { bytes, type: "image/jpeg", name: "photo.jpg" },
  );
  assert.equal(added.status, 201, JSON.stringify(added.body));

  const row = await rowByTitle(title);
  assert.equal(row.provenance, "public_domain", "the curated record keeps its provenance");
  assert.equal(
    row.source_url,
    "https://commons.wikimedia.org/wiki/File:Example.jpg",
    "and the source a moderator verified",
  );
  assert.ok(row.storage_key, "the image was stored");

  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.match(wall, new RegExp(title));

  // Curated work carries no usable recovery code, so nobody can claim it.
  assert.equal((await lookup("AAAAAAAA")).status, 404);
});

test("deleting a contribution removes its files and its row", async () => {
  const session = await adminSession();
  const title = "Test Delete Removes Files";
  const bytes = await readFile("content/seed-art/poster-stripes.png");
  await addDirectly(
    session,
    {
      kind: "poster",
      title,
      subtitle: "",
      credit: "Test",
      creditAccount: "",
      body: "",
      language: "en",
      status: "approved",
    },
    { bytes, type: "image/png", name: "p.png" },
  );
  const row = await rowByTitle(title);
  assert.ok(row, "curated poster exists");
  assert.equal((await fetch(`${baseUrl}/api/contributions/${row.id}/file`)).status, 200);

  const deleted = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: session.cookie,
      "x-tip-csrf": session.csrfToken,
    },
    body: JSON.stringify({ action: "contribution_delete", id: String(row.id) }),
  });
  assert.equal(deleted.status, 200);
  assert.equal(await rowByTitle(title), undefined, "the row is gone");
  assert.equal(
    (await fetch(`${baseUrl}/api/contributions/${row.id}/file`)).status,
    404,
    "and so is the file",
  );
});

test("both languages serve every contribution surface", async () => {
  const title = "Test Bilingual Poem";
  const sent = await submit({
    kind: "poem",
    title,
    body: "एक पंक्ति दीवार के लिए।\nऔर उसके नीचे दूसरी पंक्ति।",
    credit: "परीक्षक",
    language: "hi",
  });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });

  for (const path of ["/art", "/hi/art", "/contribute", "/hi/contribute"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, `${path} renders`);
  }
  const hindiWall = await (await fetch(`${baseUrl}/hi/art`)).text();
  assert.match(hindiWall, /कला/, "the Hindi wall is actually in Hindi");
  assert.match(hindiWall, new RegExp(title), "and carries the contribution");

  // Devanagari survives the round trip unmangled.
  const hindiRead = await (await fetch(`${baseUrl}/hi/art/${row.id}`)).text();
  assert.match(hindiRead, /एक पंक्ति दीवार के लिए।/);
});

test("posters and images open in a lightbox rather than a page of their own", async () => {
  const wall = await (await fetch(`${baseUrl}/art`)).text();
  // The artwork is a real button, so it is reachable by keyboard, and the
  // details that used to clutter each tile live behind it.
  assert.match(wall, /<button[^>]*class="gallery-art"/, "artwork is a keyboard-reachable control");
  assert.match(wall, /view larger/, "and says what it does");

  const image = await db.execute(
    "SELECT id FROM contributions WHERE kind IN ('poster','image') AND status = 'approved' LIMIT 1",
  );
  if (image.rows[0]) {
    const page = await fetch(`${baseUrl}/art/${image.rows[0].id}`);
    assert.equal(page.status, 404, "an image has no read page of its own");
  }
});

test("credit modes stay mutually exclusive and rejects are specific", async () => {
  const both = await submit({
    kind: "poem",
    title: "Test Both Credits",
    body: "Claiming an alias and an account at once.",
    credit: "An Alias",
    creditAccount: "@a-handle",
  });
  assert.equal(both.status, 400, "an alias and an account together is refused");

  const markup = await submit({
    kind: "poem",
    title: "Test Handle Markup",
    body: "A handle carrying markup.",
    creditAccount: '<script>alert(1)</script>',
  });
  assert.equal(markup.status, 400, "handles cannot carry markup");

  // A handle that is not an https link must never become an anchor.
  const bare = await submit({
    kind: "poem",
    title: "Test Bare Handle",
    body: "A bare handle is text, not a link.",
    creditAccount: "@plainhandle",
  });
  assert.equal(bare.status, 201);
  const row = await rowByTitle("Test Bare Handle");
  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });
  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.match(wall, /@plainhandle/, "the handle is shown");
  assert.doesNotMatch(
    wall,
    /<a[^>]*>@plainhandle/,
    "but only an https profile becomes a link, so no attacker-chosen scheme",
  );
});

test("contributor text is escaped rather than rendered", async () => {
  const title = "Test Escaping";
  const payload = '<img src=x onerror="alert(1)">';
  const sent = await submit({
    kind: "poem",
    title,
    body: `A line with ${payload} inside it.`,
    credit: payload,
  });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });

  for (const path of ["/art", `/art/${row.id}`]) {
    const html = await (await fetch(`${baseUrl}${path}`)).text();
    assert.doesNotMatch(html, /<img src=x onerror=/, `${path} does not render the payload`);
    assert.match(html, /&lt;img src=x/, `${path} escapes it as text`);
  }
});

test("a poem too long for its tile keeps its whole text on its own page", async () => {
  const title = "Test Long Poem";
  // Comfortably past both the character budget and the line budget.
  const lines = Array.from({ length: 30 }, (_, index) => `Line ${index + 1} of the long poem.`);
  const sent = await submit({ kind: "poem", title, body: lines.join("\n") });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });

  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.match(wall, /Read the full poem/, "the tile hands off to the page");
  // Assert on the rendered tile, not the whole document: the serialised props
  // legitimately carry more than the tile paints.
  const teaser = /<p class="tile-teaser">([\s\S]*?)<\/p>/.exec(wall)?.[1] ?? "";
  assert.match(teaser, /Line 1 of the long poem/, "the teaser starts at the beginning");
  assert.doesNotMatch(teaser, /Line 30 of the long poem/, "and stops well before the end");

  const page = await (await fetch(`${baseUrl}/art/${row.id}`)).text();
  assert.match(page, /Line 1 of the long poem/);
  assert.match(page, /Line 30 of the long poem/, "the page has every line");
});

test("length limits are enforced at both ends", async () => {
  assert.equal((await submit({ kind: "poem", title: "x", body: "long enough body" })).status, 400,
    "a one-character title is refused");
  assert.equal(
    (await submit({ kind: "poem", title: "T".repeat(121), body: "long enough body" })).status,
    400,
    "an over-long title is refused",
  );
  assert.equal((await submit({ kind: "poem", title: "Test Tiny Body", body: "ab" })).status, 400,
    "a body of two characters is refused");
  assert.equal(
    (await submit({ kind: "poem", title: "Test Over Cap", body: "x".repeat(8001) })).status,
    400,
    "a poem past its cap is refused",
  );
  assert.equal(
    (await submit({ kind: "essay", title: "Test Essay Cap", body: "x".repeat(40001) })).status,
    400,
    "an essay past its cap is refused",
  );
  // Six submissions in one scenario would trip the hourly limit, which a
  // different test covers; this one is about lengths.
  await resetRateLimits();
  // The boundary itself must be accepted, not just the far side of it.
  assert.equal(
    (await submit({ kind: "poem", title: "Test At Cap", body: "x".repeat(8000) })).status,
    201,
    "a poem exactly at the cap is accepted",
  );
});

test("a database created before provenance existed upgrades in place", async () => {
  // The riskiest migration in this feature: SQLite cannot alter a CHECK
  // constraint, so the contributions table is rebuilt. This builds a database
  // with the pre-provenance schema, fills it, and upgrades it the way a
  // deployment will.
  const legacyDir = await mkdtemp(path.join(tmpdir(), "tip-legacy-"));
  const legacyPath = path.join(legacyDir, "legacy.db").replaceAll("\\", "/");
  const legacy = createClient({ url: `file:${legacyPath}` });

  await legacy.execute(`CREATE TABLE contributions (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('poster', 'image', 'poem', 'essay')),
    title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
    credit TEXT NOT NULL DEFAULT '', credit_account TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
    storage_key TEXT, social_storage_key TEXT, mime_type TEXT,
    width INTEGER, height INTEGER, byte_size INTEGER,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
    internal_notes TEXT NOT NULL DEFAULT '', content_fingerprint TEXT,
    seeded INTEGER NOT NULL DEFAULT 0,
    decline_reason TEXT CHECK (decline_reason IN
      ('off_topic', 'not_own_work', 'identifying_info', 'low_quality', 'duplicate', 'other')),
    recovery_code_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    reviewed_by TEXT, reviewed_at TEXT, retention_eligible_at TEXT
  )`);
  await legacy.execute(
    "CREATE UNIQUE INDEX contributions_recovery_code_unique ON contributions(recovery_code_hash)",
  );
  await legacy.execute({
    sql: `INSERT INTO contributions
      (id, kind, title, body, language, status, internal_notes, recovery_code_hash,
       created_at, updated_at)
      VALUES (?, 'poem', 'Legacy Poem', 'Written before provenance existed.', 'en',
              'approved', 'a note from before', ?, ?, ?)`,
    args: [
      "11111111-1111-4111-8111-111111111111",
      "legacy-hash",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ],
  });

  const legacyCheck = await legacy.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contributions'",
  );
  assert.doesNotMatch(
    String(legacyCheck.rows[0].sql),
    /not_public_domain/,
    "the fixture really is the old schema",
  );

  // Closed before the migration runs, not after. Two processes holding native
  // handles on one SQLite file is an access violation on Windows, and the
  // handle is also what makes the temp directory un-removable at the end.
  legacy.close();

  const upgrade = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/db-setup.ts"],
    { encoding: "utf8", env: { ...process.env, LIBSQL_URL: `file:${legacyPath}` } },
  );
  assert.equal(upgrade.status, 0, upgrade.stderr || upgrade.stdout);

  // A fresh client: the connection that created the fixture held a stale schema
  // after the table was dropped and renamed underneath it, and is now closed.
  const upgraded = createClient({ url: `file:${legacyPath}` });
  const row = await upgraded.execute(
    "SELECT * FROM contributions WHERE id = '11111111-1111-4111-8111-111111111111'",
  );
  assert.equal(row.rows.length, 1, "the pre-existing row survived the rebuild");
  assert.equal(row.rows[0].title, "Legacy Poem");
  assert.equal(row.rows[0].internal_notes, "a note from before", "its columns are intact");
  assert.equal(row.rows[0].provenance, "own", "and it defaults to the contributor's own work");

  const indexes = await upgraded.execute(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'contributions'
     AND name NOT LIKE 'sqlite_%'`,
  );
  const names = indexes.rows.map((index) => String(index.name));
  for (const expected of [
    "contributions_recovery_code_unique",
    "contributions_status_idx",
    "contributions_fingerprint_idx",
    "contributions_created_idx",
  ]) {
    assert.ok(names.includes(expected), `${expected} was recreated after the rebuild`);
  }

  const firstRun = await upgraded.execute("SELECT count(*) AS total FROM contributions");
  const firstRunTotal = firstRun.rows[0].total;

  // The whole reason for the rebuild: the new reason must now be storable.
  // Through the post-rebuild client, not the one that created the fixture — a
  // connection that predates the table being dropped and renamed underneath it
  // is testing the old CHECK constraint, not the new one.
  await upgraded.execute(
    `UPDATE contributions SET decline_reason = 'not_public_domain'
     WHERE id = '11111111-1111-4111-8111-111111111111'`,
  );

  upgraded.close();

  // And running it again must be a no-op rather than a second rebuild.
  const again = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/db-setup.ts"],
    { encoding: "utf8", env: { ...process.env, LIBSQL_URL: `file:${legacyPath}` } },
  );
  assert.equal(again.status, 0, again.stderr || again.stdout);
  // db-setup also seeds the opening collection, so the meaningful property is
  // that a second run changes nothing rather than that only one row exists.
  const fresh = createClient({ url: `file:${legacyPath}` });
  const after = await fresh.execute("SELECT count(*) AS total FROM contributions");
  assert.equal(
    Number(after.rows[0].total),
    Number(firstRunTotal),
    "a second run neither duplicates nor drops rows",
  );
  const legacyStillThere = await fresh.execute(
    "SELECT count(*) AS total FROM contributions WHERE id = '11111111-1111-4111-8111-111111111111'",
  );
  assert.equal(Number(legacyStillThere.rows[0].total), 1, "and the pre-existing row is untouched");

  fresh.close();
  await rm(legacyDir, { recursive: true, force: true });
});


test("withdrawal holds for writing, not just uploads", async () => {
  const title = "Test Withdraw Then Reapprove";
  const sent = await submit({ kind: "poem", title, body: "A poem the author later took down." });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });
  assert.equal((await lookup(sent.body.recoveryCode, "withdraw")).status, 200);

  const reapprove = await moderate(session, {
    id: String(row.id),
    status: "approved",
    internalNotes: "",
  });
  assert.equal(reapprove.status, 409, "a moderator cannot undo the contributor's decision");

  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.doesNotMatch(wall, new RegExp(title));
  const read = await fetch(`${baseUrl}/art/${row.id}`);
  assert.equal(read.status, 404, "and the text stays off its page");
  assert.equal((await lookup(sent.body.recoveryCode)).body?.submission?.status, "withdrawn");
});

test("every decline reason the admin panel offers can actually be saved", async () => {
  const session = await adminSession();
  const title = "Test PD Decline Reason";
  const sent = await submit({
    kind: "poem",
    title,
    body: "Claimed as public domain but it is not.",
    credit: "Someone",
    provenance: "public_domain",
    sourceUrl: "https://example.org/not-really",
  });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);

  const declined = await moderate(session, {
    id: String(row.id),
    status: "declined",
    declineReason: "not_public_domain",
    internalNotes: "",
  });
  assert.equal(declined.status, 200, JSON.stringify(declined.body));
  const seen = await lookup(sent.body.recoveryCode);
  assert.equal(seen.body?.submission?.declineReason, "not_public_domain");
});

test("an embedded NUL cannot smuggle a value past the length floors", async () => {
  // SQLite truncates text at a NUL, so validation and storage could disagree.
  const sent = await submit({
    kind: "poem",
    title: "T\u0000his Title Would Truncate",
    body: "The first line survives.\u0000" + "and the rest of the poem follows here.",
  });
  assert.equal(sent.status, 201);
  const stored = await db.execute({
    sql: "SELECT title, body FROM contributions WHERE recovery_code_hash IS NOT NULL AND title LIKE 'This Title%'",
  });
  assert.equal(stored.rows.length, 1, "the control character is stripped, not stored");
  assert.equal(String(stored.rows[0].title), "This Title Would Truncate");
  assert.match(String(stored.rows[0].body), /and the rest of the poem follows here\./,
    "the whole body survives rather than being cut at the NUL");

  const emptied = await submit({ kind: "poem", title: "\u0000A", body: "A valid body here." });
  assert.equal(emptied.status, 400, "a title that is only a control character plus one is refused");
});

test("a rejected attempt does not cost a visitor their hourly allowance", async () => {
  await resetRateLimits();
  // Five refusals: wrong format, so nothing is ever stored.
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rejected = await submit(
      { kind: "image", title: `Test Rejected ${attempt}` },
      { bytes: gif, type: "image/png", name: "not-really.png" },
    );
    assert.ok(rejected.status >= 400, "the file is refused");
  }
  const valid = await submit({ kind: "poem", title: "Test After Rejections", body: "A valid poem." });
  assert.equal(valid.status, 201, "the visitor is not locked out by attempts that stored nothing");
});

test("a decoder failure is explained rather than dumped on the contributor", async () => {
  const truncated = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 7),
  ]);
  const response = await submit(
    { kind: "image", title: "Test Broken PNG" },
    { bytes: truncated, type: "image/png", name: "broken.png" },
  );
  assert.ok(response.status >= 400);
  const message = String(response.body?.error ?? "");
  assert.doesNotMatch(message, /vips|libpng|buffer|Input image/i, "no decoder internals leak");
  assert.match(message, /could not be read|PNG or JPEG/i, "the contributor gets written copy");
});

test("moderator edits respect the same invariants as the public form", async () => {
  const title = "Test Moderator Invariants";
  const sent = await submit({ kind: "poem", title, body: "A poem a moderator will try to break." });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();

  const bothCredits = await moderate(session, {
    id: String(row.id),
    status: "pending",
    internalNotes: "",
    credit: "An Alias",
    creditAccount: "@an-account",
  });
  assert.equal(bothCredits.status, 400, "one credit mode at a time, same as the form");

  const emptied = await moderate(session, {
    id: String(row.id),
    status: "pending",
    internalNotes: "",
    body: "",
  });
  assert.equal(emptied.status, 400, "a body cannot be emptied into a blank tile");

  const stillIntact = await rowByTitle(title);
  assert.match(String(stillIntact.body), /A poem a moderator will try to break\./);
});

test("the rate-limit bucket cannot be chosen by the caller", async () => {
  await resetRateLimits();
  // Spend the allowance while claiming one address...
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const form = humanTimings(new FormData());
    form.set("kind", "poem");
    form.set("title", `Test Bucket ${attempt}`);
    form.set("body", "Filling the hourly allowance.");
    const response = await fetch(`${baseUrl}/api/contributions`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    assert.equal(response.status, 201);
  }
  // ...then claim a different one. The first XFF element is caller-controlled,
  // so it must not select the bucket.
  const spoofed = await fetch(`${baseUrl}/api/contributions`, {
    method: "POST",
    body: (() => {
      const form = humanTimings(new FormData());
      form.set("kind", "poem");
      form.set("title", "Test Bucket Spoofed");
      form.set("body", "Claiming a fresh address.");
      return form;
    })(),
    headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.7" },
  });
  assert.equal(spoofed.status, 429, "prepending an address does not buy a new allowance");
});

test("withdrawal cannot be laundered back through pending", async () => {
  const title = "Test Withdraw Launder";
  const sent = await submit({ kind: "poem", title, body: "A poem the author took down for good." });
  const row = await rowByTitle(title);
  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });
  assert.equal((await lookup(sent.body.recoveryCode, "withdraw")).status, 200);

  // Blocking only `approved` was not enough: pending was the way around it.
  const viaPending = await moderate(session, {
    id: String(row.id),
    status: "pending",
    internalNotes: "",
  });
  assert.equal(viaPending.status, 409, "withdrawn is terminal, not merely un-approvable");

  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.doesNotMatch(wall, new RegExp(title));
});

test("a Hindi contributor is refused in Hindi", async () => {
  const form = humanTimings(new FormData());
  form.set("kind", "poem");
  form.set("title", "Test Hindi Rejection");
  form.set("body", "सार्वजनिक डोमेन का दावा बिना स्रोत के।");
  form.set("language", "hi");
  form.set("provenance", "public_domain");
  form.set("credit", "कोई पुराना कवि");
  const response = await fetch(`${baseUrl}/api/contributions`, { method: "POST", body: form });
  assert.equal(response.status, 400);
  const message = String((await response.json()).error ?? "");
  assert.match(message, /[ऀ-ॿ]/, "the refusal is in the language of the submission");
});

test("a curated public-domain work must be as checkable as a contributed one", async () => {
  const session = await adminSession();
  const bytes = await readFile("content/seed-art/poster-peaks.png");
  const noSource = await addDirectly(
    session,
    {
      kind: "image",
      title: "Test Curated No Source",
      subtitle: "",
      credit: "Unknown photographer",
      creditAccount: "",
      provenance: "public_domain",
      sourceUrl: "",
      body: "",
      language: "en",
      status: "approved",
    },
    { bytes, type: "image/png", name: "p.png" },
  );
  assert.equal(noSource.status, 400, "curation cannot skip the licence page either");

  const placeheld = await addDirectly(
    session,
    {
      kind: "poster",
      title: "Test Curated Placeholder",
      subtitle: "",
      credit: "The India Project",
      creditAccount: "",
      body: "",
      language: "en",
      status: "approved",
      placeholder: "yes",
    },
    { bytes, type: "image/png", name: "p2.png" },
  );
  assert.equal(placeheld.status, 201);
  const row = await rowByTitle("Test Curated Placeholder");
  assert.equal(Number(row.placeholder), 1, "admin-added filler is counted as a placeholder");
});

test("a retained row keeps its original deletion date when edited", async () => {
  const title = "Test Retention Frozen";
  const sent = await submit({ kind: "poem", title, body: "A poem that will be declined." });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();
  await moderate(session, {
    id: String(row.id),
    status: "declined",
    declineReason: "off_topic",
    internalNotes: "first pass",
  });
  const first = await rowByTitle(title);
  assert.ok(first.retention_eligible_at, "declining sets a deletion date");

  await moderate(session, {
    id: String(row.id),
    status: "declined",
    declineReason: "off_topic",
    internalNotes: "second pass, notes tidied",
  });
  const second = await rowByTitle(title);
  assert.equal(
    String(second.retention_eligible_at),
    String(first.retention_eligible_at),
    "editing notes does not push the deletion date out by another 180 days",
  );
});

test("schema refusals follow the language of the page too", async () => {
  // Not just the hand-written rules: the field-level messages come from the
  // schema and were English-only, so a Hindi form gave a Hindi UI and an
  // English correction.
  const form = humanTimings(new FormData());
  form.set("kind", "poem");
  form.set("title", "Test Hindi Field Error");
  form.set("body", "एक मान्य कविता।");
  form.set("language", "hi");
  form.set("creditAccount", "@मेरा हैंडल");
  const response = await fetch(`${baseUrl}/api/contributions`, {
    method: "POST",
    body: form,
    headers: { referer: `${baseUrl}/hi/contribute` },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(String(body.error), /[ऀ-ॿ]/, "the field message is in Hindi");
  assert.equal(body.field, "creditAccount", "and still names the field to fix");

  const english = await fetch(`${baseUrl}/api/contributions`, {
    method: "POST",
    body: (() => {
      const f = humanTimings(new FormData());
      f.set("kind", "poem");
      f.set("title", "Test English Field Error");
      f.set("body", "A valid poem.");
      f.set("creditAccount", "@my handle");
      return f;
    })(),
    headers: { referer: `${baseUrl}/contribute` },
  });
  assert.match(String((await english.json()).error), /without spaces/, "English is unchanged");
});

test("a half-configured bucket is refused rather than half-used", async () => {
  // Three of the four set is nearly always a typo or a half-copied credential
  // set; falling back to disk would hide it until files started disappearing.
  const probe = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "-e",
      "import('./app/lib/storage.ts').then((m) => m.putObject('11111111-1111-4111-8111-111111111111.png', new Uint8Array([1]), 'image/png')).catch((error) => { console.error(error.message); process.exit(3); })",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LIBSQL_URL: `file:${testDbPath}`,
        ART_S3_ENDPOINT: "https://example.invalid",
        ART_S3_BUCKET: "a-bucket",
        ART_S3_ACCESS_KEY_ID: "an-id",
        ART_S3_SECRET_ACCESS_KEY: "",
      },
    },
  );
  assert.equal(probe.status, 3, probe.stdout || probe.stderr);
  assert.match(
    probe.stderr,
    /half configured|ART_S3_SECRET_ACCESS_KEY/,
    "the missing variable is named",
  );
});

test("withdrawing writing erases the writing", async () => {
  const title = "Test Withdraw Erases Text";
  const body = "A verse the author later needs gone, word for word.";
  const sent = await submit({ kind: "poem", title, body, credit: "A Contributor" });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });
  assert.equal((await lookup(sent.body.recoveryCode, "withdraw")).status, 200);

  // Nulling the storage keys removed nothing for a poem: the body IS the work.
  //
  // Every column, not a sample. The fingerprint in particular: it is a hash of
  // the work, so leaving it behind keeps a derived identifier of material the
  // contributor just asked to have removed.
  const after = await db.execute({
    sql: `SELECT body, title, subtitle, credit, credit_account, source_url,
                 storage_key, social_storage_key, content_fingerprint
          FROM contributions WHERE id = ?`,
    args: [String(row.id)],
  });
  const erased = after.rows[0];
  assert.doesNotMatch(String(erased.title), /Withdraw Erases/, "the title is gone");
  for (const column of [
    "body",
    "subtitle",
    "credit",
    "credit_account",
    "source_url",
    "storage_key",
    "social_storage_key",
    "content_fingerprint",
  ]) {
    const value = erased[column];
    assert.ok(
      value === null || value === "",
      `withdrawal leaves ${column} empty — it did not`,
    );
  }

  // A moderator loading the panel must not receive it either.
  const panel = await fetch(`${baseUrl}/api/admin`, { headers: { cookie: session.cookie } });
  assert.doesNotMatch(JSON.stringify(await panel.json()), new RegExp(body.slice(0, 20)));
});

test("the public payload does not carry a submission timestamp", async () => {
  const title = "Test Timestamp Precision";
  const sent = await submit({ kind: "poem", title, body: "A poem whose upload time is nobody's business." });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();
  await moderate(session, { id: String(row.id), status: "approved", internalNotes: "" });

  // An exact millisecond next to a network log links a poster to an uploader.
  const wall = await (await fetch(`${baseUrl}/art`)).text();
  assert.match(wall, new RegExp(title), "the work is on the wall");
  const stamp = String(row.created_at);
  assert.doesNotMatch(wall, new RegExp(stamp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the exact submission instant is not in the page");
  assert.doesNotMatch(wall, /\d{2}:\d{2}:\d{2}\.\d{3}Z/, "no millisecond timestamps at all");
});

test("a stored image is bounded, not just the upload", async () => {
  // A 4 MB upload could re-encode to a ~76 MB lossless PNG and sit in the
  // bucket at that size; the input cap alone did not bound what we store.
  const bytes = await readFile("content/seed-art/image-breaking-the-salt-law.jpg");
  const title = "Test Stored Size";
  const sent = await submit({ kind: "image", title }, { bytes, type: "image/jpeg", name: "p.jpg" });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  assert.ok(Number(row.byte_size) < 12 * 1024 * 1024, `stored print is bounded (${row.byte_size})`);
  assert.ok(Number(row.width) <= 3000 && Number(row.height) <= 3000,
    `stored dimensions are bounded (${row.width}x${row.height})`);
});

test("curation holds to the same credit rules as the public form", async () => {
  const session = await adminSession();
  const bytes = await readFile("content/seed-art/poster-sunrise.png");
  const both = await addDirectly(
    session,
    {
      kind: "poster", title: "Test Curate Both Credits", subtitle: "",
      credit: "An Author", creditAccount: "@ourhandle", body: "", language: "en", status: "approved",
    },
    { bytes, type: "image/png", name: "p.png" },
  );
  assert.equal(both.status, 400, "an alias and an account together is refused here too");

  const pdAccount = await addDirectly(
    session,
    {
      kind: "image", title: "Test Curate PD Account", subtitle: "",
      credit: "", creditAccount: "@ourhandle", provenance: "public_domain",
      sourceUrl: "https://commons.example/file", body: "", language: "en", status: "approved",
    },
    { bytes, type: "image/png", name: "p2.png" },
  );
  assert.equal(pdAccount.status, 400, "someone else's work is never credited to our account");
});

test("a moderator edit cannot produce a row the public form would refuse", async () => {
  const title = "Test Merged Invariants";
  const sent = await submit({ kind: "poem", title, body: "A poem to edit.", creditAccount: "@theirhandle" });
  assert.equal(sent.status, 201);
  const row = await rowByTitle(title);
  const session = await adminSession();

  // Sending only `credit` against a row that already holds an account left
  // both set — the guard checked the request rather than the resulting row.
  const sneaked = await moderate(session, {
    id: String(row.id), status: "pending", internalNotes: "", credit: "An Alias",
  });
  assert.equal(sneaked.status, 400, "the merged row is checked, not just the request");

  const tooLong = await moderate(session, {
    id: String(row.id), status: "pending", internalNotes: "", body: "x".repeat(9000),
  });
  assert.equal(tooLong.status, 400, "a poem cannot be edited past the poem cap");
});

test("a poster is kept printable at A3, in a format that suits it", async () => {
  // A3 at 300dpi needs a 4961px edge; capping below that would quietly make
  // the wall's own "download and print" promise untrue.
  const flat = await readFile("content/seed-art/poster-stripes.png");
  const posterTitle = "Test Print Quality Poster";
  assert.equal(
    (await submit({ kind: "poster", title: posterTitle }, { bytes: flat, type: "image/png", name: "p.png" })).status,
    201,
  );
  const poster = await rowByTitle(posterTitle);
  assert.equal(poster.mime_type, "image/png", "flat poster art stays lossless");

  const photo = await readFile("content/seed-art/image-breaking-the-salt-law.jpg");
  const photoTitle = "Test Print Quality Photo";
  assert.equal(
    (await submit({ kind: "image", title: photoTitle }, { bytes: photo, type: "image/jpeg", name: "p.jpg" })).status,
    201,
  );
  const stored = await rowByTitle(photoTitle);
  assert.equal(stored.mime_type, "image/jpeg", "a photograph is not re-encoded to a huge PNG");

  const session = await adminSession();
  await moderate(session, { id: String(stored.id), status: "approved", internalNotes: "" });
  const served = await fetch(`${baseUrl}/api/contributions/${stored.id}/file`);
  assert.equal(served.status, 200);
  assert.equal(
    served.headers.get("content-type"),
    "image/jpeg",
    "and it is served as what it actually is",
  );
});

test("a rate limit holds under concurrency, not just in sequence", async () => {
  // Read-then-write let every concurrent request see the same under-limit
  // count and all pass. Recovery-code lookup is the reason this matters: the
  // limit is the only thing between a guessable code and an irreversible
  // withdrawal, and a hundred parallel guesses used to cost the price of one.
  const attempts = 100;
  const results = await Promise.all(
    Array.from({ length: attempts }, () => lookup("ZZZZZZZZ", "status")),
  );
  const accepted = results.filter((r) => r.status !== 429).length;
  const refused = results.filter((r) => r.status === 429).length;

  assert.equal(accepted + refused, attempts, "every request got a verdict");
  // The endpoint allows 10 per quarter hour. Concurrency must not buy a
  // single extra attempt, so this is the exact limit, not a loose fraction of
  // the burst — a check that only asserted "most were refused" would still
  // pass if the race let through twenty.
  assert.ok(
    accepted <= 10,
    `${accepted} of ${attempts} concurrent guesses passed a limit of 10`,
  );
  assert.ok(refused > 0, "the burst was actually rate limited at all");

  const { rows } = await db.execute(
    "SELECT count FROM rate_limits WHERE action = 'contribution-lookup'",
  );
  if (rows.length > 0) {
    assert.ok(
      Number(rows[0].count) <= accepted,
      "the stored count never exceeds what was actually let through",
    );
  }
});

test("a moderator cannot move a public-domain work onto someone's account", async () => {
  // Only the "not both" rule was mirrored from the public form. Clearing the
  // credit and setting an account satisfied it while doing the exact damage
  // the rule exists to prevent: the author's name off the work, a living
  // person's handle on it.
  const title = "Test PD Attribution Guard";
  await submit({
    kind: "poem",
    title,
    body: "An old verse nobody alive wrote.",
    provenance: "public_domain",
    sourceUrl: "https://example.org/source",
    credit: "A Long-Dead Poet",
  });
  const row = await rowByTitle(title);
  const session = await adminSession();

  const stolen = await moderate(session, {
    id: String(row.id),
    status: "pending",
    internalNotes: "",
    credit: "",
    creditAccount: "@someone_alive",
  });
  assert.equal(stolen.status, 400, "the swap is refused");

  const stripped = await moderate(session, {
    id: String(row.id),
    status: "pending",
    internalNotes: "",
    credit: "",
  });
  assert.equal(stripped.status, 400, "and so is simply removing the author");

  const unchanged = await rowByTitle(title);
  assert.equal(unchanged.credit, "A Long-Dead Poet", "the attribution survived both attempts");
  assert.equal(unchanged.credit_account, "");
});

test("a failed insert takes its files back out of storage", async () => {
  // The compensation path had never actually run — it was written by reading
  // the code, which is how it shipped with the bug that the keys it cleans up
  // are assigned only after both puts succeed. Force the insert to fail and
  // watch the bucket, rather than trusting that the handler is right.
  const { readdir } = await import("node:fs/promises");
  const uploads = path.join(process.cwd(), "data", "uploads");
  const before = new Set(await readdir(uploads).catch(() => []));

  await db.execute(`CREATE TRIGGER induced_insert_failure
    BEFORE INSERT ON contributions
    BEGIN SELECT RAISE(ABORT, 'induced failure'); END`);
  let sent;
  try {
    const bytes = await readFile("content/seed-art/poster-stripes.png");
    sent = await submit(
      { kind: "poster", title: "Test Insert Failure" },
      { bytes, type: "image/png", name: "poster.png" },
    );
  } finally {
    await db.execute("DROP TRIGGER induced_insert_failure");
  }

  assert.notEqual(sent.status, 201, "the submission must not report success");
  const after = await readdir(uploads).catch(() => []);
  const leaked = after.filter((name) => !before.has(name));
  assert.deepEqual(
    leaked,
    [],
    `the failed submission left ${leaked.length} file(s) nothing points at: ${leaked.join(", ")}`,
  );

  const { rows } = await db.execute({
    sql: "SELECT count(*) AS n FROM contributions WHERE title = ?",
    args: ["Test Insert Failure"],
  });
  assert.equal(Number(rows[0].n), 0, "and no row was written either");
});

test("a submission survives an audit line that will not write", async () => {
  // Past the insert the contributor's only copy of their recovery code is in
  // the response we are about to send. Turning an audit failure into an error
  // page would leave a row nobody can ever withdraw.
  await db.execute(`CREATE TRIGGER induced_audit_failure
    BEFORE INSERT ON audit_events
    BEGIN SELECT RAISE(ABORT, 'induced failure'); END`);
  let sent;
  try {
    sent = await submit({
      kind: "poem",
      title: "Test Audit Failure",
      body: "A verse submitted while the audit table refuses writes.",
      credit: "Alias",
    });
  } finally {
    await db.execute("DROP TRIGGER induced_audit_failure");
  }

  assert.equal(sent.status, 201, "the contributor still gets their code");
  assert.ok(sent.body?.recoveryCode, "and the code is actually in the response");

  const stored = await rowByTitle("Test Audit Failure");
  assert.ok(stored, "the submission is stored");

  // The code the contributor was handed must still work, or the row is one
  // they can never reach.
  const status = await lookup(sent.body.recoveryCode, "status");
  assert.equal(status.status, 200, "and the code they were given still resolves");
});

test("an image that fails to decode still costs its sender an allowance", async () => {
  // Decoding is the expensive part of a submission — up to MAX_INPUT_PIXELS of
  // work. A file that fails inside processing never reaches the submit
  // allowance, so before this guard the same upload could be resent without
  // end and every attempt paid for a full decode. The allowance below is
  // deliberately looser than the submit one: it exists to bound work, not to
  // ration submissions.
  const real = await readFile("content/seed-art/poster-stripes.png");
  // Keeps the PNG signature and header, so it passes the magic-byte gate and
  // the decoder has to start work before discovering it is unusable.
  const corrupt = Buffer.from(real);
  corrupt.fill(0x7f, Math.floor(corrupt.length * 0.4));

  const send = (n) =>
    submit(
      { kind: "image", title: `Test Decode Allowance ${n}` },
      { bytes: corrupt, type: "image/png", name: "corrupt.png" },
    );

  const first = await send(0);
  assert.equal(first.status, 400, "an unusable image is refused");

  // One rejected attempt must already have cost something, which is the whole
  // difference from before: rejected uploads were free.
  const consumed = await db.execute(
    "SELECT count FROM rate_limits WHERE action = 'contribution-decode'",
  );
  assert.equal(consumed.rows.length, 1, "a rejected upload consumes decode allowance");
  assert.equal(Number(consumed.rows[0].count), 1);

  // And the allowance has to actually run out, or it bounds nothing.
  let refusedAt = null;
  for (let n = 1; n <= 40 && refusedAt === null; n += 1) {
    if ((await send(n)).status === 429) refusedAt = n;
  }
  assert.ok(refusedAt !== null, "the decode allowance never ran out");

  // Refusal must come before the decoder, so the count stops climbing.
  const capped = await db.execute(
    "SELECT count FROM rate_limits WHERE action = 'contribution-decode'",
  );
  assert.ok(
    Number(capped.rows[0].count) <= refusedAt + 1,
    "refusals are not themselves paying for a decode",
  );

  const stored = await db.execute(
    "SELECT count(*) AS n FROM contributions WHERE title LIKE 'Test Decode Allowance%'",
  );
  assert.equal(Number(stored.rows[0].n), 0, "and none of them were stored");
});
