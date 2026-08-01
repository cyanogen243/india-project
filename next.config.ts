import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://platform.twitter.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://pbs.twimg.com https://abs.twimg.com; font-src 'self'; connect-src 'self'; media-src 'self'; frame-src https://platform.twitter.com https://syndication.twitter.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Self-contained server bundle for the container image; ignored by Vercel.
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    // In dev, /sw.js must serve the self-destruct worker (public/sw-dev.js):
    // a cache-first worker left by an old session pins its tab to stale
    // HTML/CSS/JS, and the update check is the only request that reaches the
    // browser past that worker. beforeFiles is required to shadow public/.
    if (process.env.NODE_ENV !== "development") return [];
    return {
      beforeFiles: [{ source: "/sw.js", destination: "/sw-dev.js" }],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/api/admin",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        // Contributor files are re-encoded by us and served with a known type,
        // but they are still the one response body originating from an
        // untrusted source. Nothing on this route needs to load anything.
        source: "/api/contributions/:id/file",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; sandbox" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
