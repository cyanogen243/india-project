import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

let server;
let baseUrl;
let testDbDir;
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

before(async () => {
  testDbDir = await mkdtemp(path.join(tmpdir(), "tip-test-"));
  const dbPath = path.join(testDbDir, "app.db").replaceAll("\\", "/");
  const { privateKey } = generateKeyPairSync("ed25519");
  const testEnv = {
    ...process.env,
    LIBSQL_URL: `file:${dbPath}`,
    ADMIN_BOOTSTRAP_EMAIL: superAdminEmail,
    ADMIN_BOOTSTRAP_NAME: "Local Owner",
    ADMIN_BOOTSTRAP_PASSWORD: superAdminPassword,
    SESSION_SECRET: "test-session-secret-not-for-production",
    RATE_LIMIT_SECRET: "test-rate-limit-secret-not-for-production",
    FEED_SIGNING_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
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
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await exited;
  }
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
  assert.match(html, /Volunteer with us/i);
  assert.match(html, /What is happening, and why it matters/i);
  assert.match(html, /href="\/resources">Resources</i);
  assert.doesNotMatch(html, /Hall of Shame|\/hall-of-shame/i);

  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    ["/brand/compact-logo.png", "/icon-192.png", "/icon-512.png"],
  );
});

test("renders Hindi and keeps hidden routes unavailable", async () => {
  const [hindi, hiddenMediaArchive] = await Promise.all([
    render("/hi"),
    render("/hall-of-shame"),
  ]);

  assert.equal(hindi.status, 200);
  assert.equal(hiddenMediaArchive.status, 404);
  assert.match(await hindi.text(), /स्वयंसेवा करें/i);
});

test("accepts volunteers and enforces the audited admin workflow", async () => {
  const volunteerResponse = await fetch(`${baseUrl}/api/volunteers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Review Volunteer",
      email: "volunteer@example.test",
      skills: ["source-review", "translation"],
      languages: ["English", "Hindi"],
      availability: "Three hours each week",
      note: "I can review sources and help prepare clear bilingual summaries.",
      language: "en",
      consent: true,
      website: "",
      startedAt: Date.now() - 5000,
    }),
  });
  assert.equal(volunteerResponse.status, 201);

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
  assert.equal(adminData.volunteers[0].email, "volunteer@example.test");

  const volunteerUpdate = await adminRequest({
    action: "volunteer_update",
    id: adminData.volunteers[0].id,
    status: "contacted",
    internalNotes: "Initial review complete.",
  });
  assert.equal(volunteerUpdate.response.status, 200);

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
