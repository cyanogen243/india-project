import type { NextRequest } from "next/server";

/**
 * Who a request came from, for the rate limiters and the visitor counter.
 *
 * This deployment is Cloudflare in front of Vercel, so `CF-Connecting-IP` is
 * the answer. Cloudflare sets it on every request and overwrites whatever the
 * caller sent, which is what makes it trustworthy — and it is the only header
 * here that survives the second hop, because Vercel sees the Cloudflare edge
 * as its client rather than the visitor.
 *
 * `X-Forwarded-For` cannot do this job on this deployment. Cloudflare *appends*
 * to it, so a caller can put their own value in front, and Vercel then appends
 * the edge address behind — leaving neither end reliably the visitor. Reading
 * the last entry, which is correct behind a single appending proxy, yields the
 * Cloudflare edge here: everyone routed through one edge counts as one person,
 * so five submissions an hour is five between all of them and real
 * contributors are turned away.
 *
 * The fallback below only ever runs on a request that did not come through
 * Cloudflare, where nothing in the request is trustworthy anyway. It is kept
 * because the test suites use it to tell simulated visitors apart, and because
 * requests that skip Cloudflare should not reach this application at all — the
 * fix for those is to close that path, not to guess harder here.
 */
export function remoteIdentifier(request: NextRequest | Request): string {
  const edge = request.headers.get("cf-connecting-ip")?.trim();
  if (edge) return edge;

  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded?.[forwarded.length - 1] || "unknown";
}
