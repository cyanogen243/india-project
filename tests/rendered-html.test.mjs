import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the verified public-interest homepage", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /script-src[^;]*https:\/\/platform\.twitter\.com/);
  assert.match(csp, /frame-src[^;]*https:\/\/platform\.twitter\.com/);

  const html = await response.text();
  assert.match(html, /The India Project/);
  assert.match(
    html,
    /<link rel="icon" href="(?:https?:\/\/[^"]+)?\/brand\/compact-logo\.png"/,
  );
  assert.match(html, /Safe · Verified · People powered/i);
  assert.match(html, /exam-accountability movement continues/i);
  assert.match(html, /Live verified feed/);
  assert.match(html, /New sources checked now/);
  assert.match(html, /Updates from @Cockroachisback/);
  assert.match(html, /Load live X feed/);
  assert.match(html, /Share verified receipt/);
  assert.match(html, /Volunteer with us/);
  assert.match(html, /What is happening, and why it matters/);
  assert.doesNotMatch(html, /Hall of Shame|\/hall-of-shame/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|googleapis|<iframe/i);
});

test("renders Hindi, receipts, and the no-upload evidence page", async () => {
  const [hindi, receipts, evidence, hiddenMediaArchive] = await Promise.all([
    render("/hi"),
    render("/receipts"),
    render("/evidence"),
    render("/hall-of-shame"),
  ]);

  assert.equal(hindi.status, 200);
  assert.equal(receipts.status, 200);
  assert.equal(evidence.status, 200);
  assert.equal(hiddenMediaArchive.status, 404);

  const hindiHtml = await hindi.text();
  assert.match(hindiHtml, /परीक्षा जवाबदेही आंदोलन जारी/);
  assert.doesNotMatch(hindiHtml, /\/hi\/hall-of-shame/i);
  const receiptsHtml = await receipts.text();
  assert.match(receiptsHtml, /Share the receipts/);
  assert.match(receiptsHtml, /Share verified receipt/);
  assert.match(receiptsHtml, /Copy receipt/);

  const evidenceHtml = await evidence.text();
  assert.match(evidenceHtml, /No files can be uploaded here/);
  assert.doesNotMatch(evidenceHtml, /<form|type="file"/i);
});

test("the Worker bundle carries no native module", async () => {
  // Importing this artifact in Node proves nothing about the runtime it ships
  // to: Node loads native bindings happily, and a Cloudflare Worker cannot load
  // them at all. sharp reached the bundle through `app/lib/contributions.ts`,
  // which routes import for its recovery-code helpers and size constants, so a
  // module-scope import there took down the whole Worker on start — including
  // text contributions and every route that never touches an image.
  //
  // The bundle is the only place this is visible without a real isolate, so the
  // bundle is what gets checked.
  const { readFile } = await import("node:fs/promises");
  const bundle = await readFile(
    new URL("../dist/server/index.js", import.meta.url),
    "utf8",
  );
  for (const marker of ["node_modules/sharp/", "@img/sharp"]) {
    assert.ok(
      !bundle.includes(marker),
      `${marker} is in the Worker bundle — load it inside the function that needs it instead`,
    );
  }
});
