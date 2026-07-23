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
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);

  const html = await response.text();
  assert.match(html, /The India Project/);
  assert.match(html, /exam-accountability movement continues/i);
  assert.match(html, /Live verified feed/);
  assert.match(html, /New sources checked now/);
  assert.match(html, /Share verified receipt/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|googleapis|<iframe/i);
});

test("renders Hindi, receipts, and the no-upload evidence page", async () => {
  const [hindi, receipts, evidence] = await Promise.all([
    render("/hi"),
    render("/receipts"),
    render("/evidence"),
  ]);

  assert.equal(hindi.status, 200);
  assert.equal(receipts.status, 200);
  assert.equal(evidence.status, 200);

  assert.match(await hindi.text(), /परीक्षा जवाबदेही आंदोलन जारी/);
  assert.match(await receipts.text(), /Share the receipts/);

  const evidenceHtml = await evidence.text();
  assert.match(evidenceHtml, /No files can be uploaded here/);
  assert.doesNotMatch(evidenceHtml, /<form|type="file"/i);
});
