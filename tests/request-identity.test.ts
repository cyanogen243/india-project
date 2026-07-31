import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteIdentifier } from "../app/lib/request-identity";

/**
 * Who a caller is decides which rate-limit bucket they land in, so it is
 * pinned down here rather than by standing up a server per deployment shape.
 */

function request(headers: Record<string, string>) {
  return new Request("https://www.theindiaproject.net/api/contributions", { headers });
}

test("the Cloudflare header identifies the visitor, not the edge in front of us", () => {
  // What production actually sends: Cloudflare names the visitor, and by the
  // time Vercel has appended the peer it saw, the last X-Forwarded-For entry
  // is the Cloudflare edge — the same value for everyone routed through it.
  const edge = "172.71.10.5";
  const first = remoteIdentifier(
    request({ "cf-connecting-ip": "49.36.180.1", "x-forwarded-for": `49.36.180.1, ${edge}` }),
  );
  const second = remoteIdentifier(
    request({ "cf-connecting-ip": "49.36.180.2", "x-forwarded-for": `49.36.180.2, ${edge}` }),
  );

  assert.equal(first, "49.36.180.1");
  assert.equal(second, "49.36.180.2");
  assert.notEqual(first, second, "two visitors through one edge are two callers");
});

test("one visitor stays one caller across requests", () => {
  const headers = { "cf-connecting-ip": "49.36.180.7", "x-forwarded-for": "49.36.180.7, 172.71.10.5" };
  assert.equal(remoteIdentifier(request(headers)), remoteIdentifier(request(headers)));
});

test("a caller cannot prepend their way out of their bucket", () => {
  // Cloudflare appends to X-Forwarded-For rather than replacing it, so a
  // caller can put anything in front. CF-Connecting-IP is overwritten, so it
  // is the value that decides.
  assert.equal(
    remoteIdentifier(
      request({
        "cf-connecting-ip": "49.36.180.7",
        "x-forwarded-for": "1.1.1.1, 49.36.180.7, 172.71.10.5",
      }),
    ),
    "49.36.180.7",
  );
});

test("without the Cloudflare header, the trailing forwarded entry is used", () => {
  // Only reachable on a request that did not come through Cloudflare.
  assert.equal(remoteIdentifier(request({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  assert.equal(
    remoteIdentifier(request({ "x-forwarded-for": "198.51.100.9, 203.0.113.7" })),
    "203.0.113.7",
  );
});

test("a request with nothing to go on does not become a blank identity", () => {
  assert.equal(remoteIdentifier(request({})), "unknown");
  assert.equal(remoteIdentifier(request({ "x-forwarded-for": " , , " })), "unknown");
  assert.equal(remoteIdentifier(request({ "cf-connecting-ip": "  " })), "unknown");
});
