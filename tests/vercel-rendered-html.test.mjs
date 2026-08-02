import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { startTestServer, stopTestServer } from "./helpers/server.mjs";

let server;
let baseUrl;
let testDbDir;
let testDbPath;
const superAdminEmail = "owner@example.test";
const superAdminPassword = "LocalReviewPassword!2026";


before(async () => {
  testDbDir = await mkdtemp(path.join(tmpdir(), "tip-test-"));
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
  ({ server, baseUrl } = await startTestServer(testEnv));
});

after(async () => {
  await stopTestServer(server);
  if (testDbDir) await rm(testDbDir, { recursive: true, force: true });
});

async function render(pathname = "/") {
  return fetch(`${baseUrl}${pathname}`, {
    headers: { accept: "text/html" },
  });
}

test("renders the Vercel-ready public-interest homepage", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /default-src 'self'/,
  );
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");

  const html = await response.text();
  assert.match(html, /The India Project/);
  assert.match(
    html,
    /<link rel="icon" href="(?:https?:\/\/[^"]+)?\/brand\/compact-logo\.png"/,
  );
  assert.match(html, /Safe · Verified · People powered/i);
  assert.match(html, /exam-accountability movement continues/i);
  assert.doesNotMatch(html, /href="(?:\/hi)?\/volunteer|Volunteer with us/i);
  assert.match(html, /What is happening, and why it matters/i);
  assert.match(html, /href="\/resources">Partners &amp; resources</i);
  assert.match(html, /People-powered reach/i);
  assert.doesNotMatch(html, /Hall of Shame|\/hall-of-shame/i);

  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    ["/brand/compact-logo.png", "/icon-192.png", "/icon-512.png"],
  );
});

test("renders Hindi and keeps closed or hidden routes unavailable", async () => {
  const [hindi, volunteer, hiddenHindiVolunteer, removedLegal, hiddenMediaArchive] = await Promise.all([
    render("/hi"),
    render("/volunteer"),
    render("/hi/volunteer"),
    render("/legal"),
    render("/hall-of-shame"),
  ]);

  assert.equal(hindi.status, 200);
  assert.equal(volunteer.status, 404);
  assert.equal(hiddenHindiVolunteer.status, 404);
  assert.equal(removedLegal.status, 404);
  assert.equal(hiddenMediaArchive.status, 404);

  const resourcesHtml = await (await render("/resources")).text();
  assert.match(resourcesHtml, /Partner links/i);
  assert.match(resourcesHtml, /CJP Delhi Protest Hub/i);
  assert.match(resourcesHtml, /India Tech Collective/i);
  assert.match(
    resourcesHtml,
    /https:\/\/cockroachjantaparty\.raizian\.in\/delhi-protest/i,
  );
  assert.match(
    resourcesHtml,
    /https:\/\/www\.indiatechcollective\.org\//i,
  );
});

test("serves the receipts page, and an evidence page that takes no uploads", async () => {
  const [receipts, evidence] = await Promise.all([render("/receipts"), render("/evidence")]);
  assert.equal(receipts.status, 200);
  assert.equal(evidence.status, 200);

  const receiptsHtml = await receipts.text();
  assert.match(receiptsHtml, /Share the receipts/);
  assert.match(receiptsHtml, /Share verified receipt/);
  assert.match(receiptsHtml, /Copy receipt/);

  const evidenceHtml = await evidence.text();
  assert.match(evidenceHtml, /No files can be uploaded here/);
  assert.doesNotMatch(evidenceHtml, /<form|type="file"/i);
});

test("keeps admin, API, and live page visits out of stale service-worker caches", async () => {
  const worker = await readFile(path.join(process.cwd(), "public", "sw.js"), "utf8");
  assert.match(worker, /the-india-project-v7/);
  assert.doesNotMatch(worker, /\/volunteer/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.pathname === "\/admin"/);
  assert.match(worker, /url\.searchParams\.has\("_rsc"\)/);
  assert.match(worker, /event\.request\.mode === "navigate"/);

  const bypassIndex = worker.indexOf('url.pathname.startsWith("/api/")');
  const cacheMatchIndex = worker.indexOf("caches.match(event.request)");
  assert.ok(bypassIndex >= 0 && bypassIndex < cacheMatchIndex);
});

test("masks personal display names for super-admin accounts", async () => {
  const adminSource = await readFile(
    path.join(process.cwd(), "app", "admin", "AdminApp.tsx"),
    "utf8",
  );
  assert.match(
    adminSource,
    /user\.role === "super_admin" \? "Super admin" : user\.displayName/,
  );
  assert.doesNotMatch(adminSource, /<strong>\{user\.displayName\}<\/strong>/);
  assert.doesNotMatch(adminSource, /<p>\{data\.user\.displayName\}/);
});

test("counts repeat visitors once per network per day without raw identifiers", async () => {
  const headers = { "x-forwarded-for": "203.0.113.42" };
  const firstResponse = await fetch(`${baseUrl}/api/visitor-count`, {
    method: "POST",
    headers,
  });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.total, 1);

  const repeatResponse = await fetch(`${baseUrl}/api/visitor-count`, {
    method: "POST",
    headers,
  });
  assert.equal(repeatResponse.status, 200);
  assert.deepEqual(await repeatResponse.json(), first);

  const secondVisitorResponse = await fetch(`${baseUrl}/api/visitor-count`, {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.24" },
  });
  assert.equal(secondVisitorResponse.status, 200);
  assert.deepEqual(await secondVisitorResponse.json(), { total: 2 });

  const testDatabase = createClient({ url: `file:${testDbPath}` });
  const totals = await testDatabase.execute(
    "SELECT total FROM visitor_totals WHERE id = 'site'",
  );
  const identifiers = await testDatabase.execute(
    "SELECT identifier_hash FROM visitor_daily_identifiers ORDER BY identifier_hash",
  );
  testDatabase.close();
  assert.equal(Number(totals.rows[0].total), 2);
  assert.equal(identifiers.rows.length, 2);
  assert.ok(
    identifiers.rows.every(
      (row) =>
        !String(row.identifier_hash).includes("203.0.113.42") &&
        !String(row.identifier_hash).includes("198.51.100.24"),
    ),
  );
});

test("keeps volunteer intake closed and enforces the audited admin workflow", async () => {
  const closedVolunteerResponse = await fetch(`${baseUrl}/api/volunteers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(closedVolunteerResponse.status, 410);
  assert.match((await closedVolunteerResponse.json()).error, /closed/i);

  const anonymous = await fetch(`${baseUrl}/api/admin`);
  assert.deepEqual(await anonymous.json(), { authenticated: false });

  const loginResponse = await fetch(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email: superAdminEmail,
      password: superAdminPassword,
    }),
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  async function adminRequest(body) {
    const snapshotResponse = await fetch(`${baseUrl}/api/admin`, {
      headers: { cookie },
    });
    const snapshot = await snapshotResponse.json();
    const response = await fetch(`${baseUrl}/api/admin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-tip-csrf": snapshot.user.csrfToken,
      },
      body: JSON.stringify(body),
    });
    return { response, value: await response.json(), snapshot };
  }

  const initial = await fetch(`${baseUrl}/api/admin`, { headers: { cookie } });
  const adminData = await initial.json();
  assert.equal(adminData.user.role, "super_admin");

  const createdAdmin = await adminRequest({
    action: "user_create",
    email: "editor@example.test",
    displayName: "Review Editor",
    role: "admin",
  });
  assert.equal(createdAdmin.response.status, 200);
  assert.match(createdAdmin.value.temporaryPassword, /!/);

  const resources = adminData.content.filter(
    (entry) => entry.collection === "resources",
  );
  const target = resources.find(
    (entry) => entry.recordId === "nalsa-legal-aid" && entry.language === "en",
  );
  assert.ok(target);
  const marker = "Official legal-aid information reviewed for local CMS testing.";
  const saved = await adminRequest({
    action: "content_save",
    id: target.id,
    collection: "resources",
    recordId: target.recordId,
    language: target.language,
    sortOrder: target.sortOrder,
    payload: { ...target.draft, summary: marker },
  });
  assert.equal(saved.response.status, 200);
  const published = await adminRequest({
    action: "content_publish_collection",
    collection: "resources",
  });
  assert.equal(published.response.status, 200);
  assert.match(await (await render("/resources")).text(), new RegExp(marker));

  const feedPublish = await adminRequest({
    action: "content_publish_collection",
    collection: "updates",
  });
  assert.equal(feedPublish.response.status, 200);
  const [payloadResponse, signatureResponse, publicKeyResponse] = await Promise.all([
    fetch(`${baseUrl}/feed/updates.json`),
    fetch(`${baseUrl}/feed/updates.sig`),
    fetch(`${baseUrl}/feed/public-key.txt`),
  ]);
  const payload = await payloadResponse.text();
  const signature = (await signatureResponse.text()).trim();
  const publicKey = await publicKeyResponse.text();
  assert.equal(
    verify(null, Buffer.from(payload.trimEnd()), publicKey, Buffer.from(signature, "base64")),
    true,
  );
});
