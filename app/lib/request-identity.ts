import type { NextRequest } from "next/server";

/**
 * Who a request came from, for the rate limiters and the visitor counter.
 *
 * Cloudflare fronts this deployment, and `CF-Connecting-IP` is the visitor:
 * Cloudflare sets it on every request, overwriting what the caller sent.
 * `X-Forwarded-For` cannot serve — each proxy on the way appends to it, so its
 * trailing entry is the edge, shared by everyone routed through it, and its
 * leading entry is the caller's to choose.
 *
 * The fallback applies only to requests that arrive without Cloudflare, where
 * no header is trustworthy. Those should not reach the application at all; the
 * answer is to close that route rather than to guess better here.
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
