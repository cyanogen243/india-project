import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import net from "node:net";

let server;
let baseUrl;

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
  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    { stdio: "ignore" },
  );
  await waitForServer(baseUrl);
});

after(() => {
  server?.kill("SIGTERM");
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
  assert.match(html, /brand-mark/);
  assert.match(
    html,
    /<link rel="icon" href="(?:https?:\/\/[^"]+)?\/brand-mark\.svg"/,
  );
  assert.doesNotMatch(html, /class="brand-mark"[^>]*>S</);
  assert.match(html, /exam-accountability movement continues/i);
  assert.doesNotMatch(html, /Call for volunteers|Register your interest|github\.com/i);
  assert.doesNotMatch(html, /Hall of Shame|\/hall-of-shame/i);

  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    ["/brand-mark.svg", "/icon-192.png", "/icon-512.png"],
  );
});

test("renders Hindi and keeps hidden routes unavailable", async () => {
  const [hindi, hiddenMediaArchive] = await Promise.all([
    render("/hi"),
    render("/hall-of-shame"),
  ]);

  assert.equal(hindi.status, 200);
  assert.equal(hiddenMediaArchive.status, 404);
  assert.doesNotMatch(await hindi.text(), /स्वयंसेवकों की आवश्यकता|github\.com/i);
});
