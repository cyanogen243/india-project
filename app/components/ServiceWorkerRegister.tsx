"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    // The worker is cache-first for static assets. In development chunk URLs
    // are stable across rebuilds, so a registered worker keeps serving stale
    // CSS and JS through every refresh. Production filenames are fingerprinted
    // per deploy, so caching is safe there.
    if (process.env.NODE_ENV !== "production") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The site remains fully usable without the optional offline cache.
      });
    }
  }, []);
  return null;
}
