"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    // The worker is cache-first for static assets. In development chunk URLs
    // are stable across rebuilds, so a registered worker keeps serving stale
    // CSS and JS through every refresh. Production filenames are fingerprinted
    // per deploy, so caching is safe there.
    if (process.env.NODE_ENV !== "production") {
      // Destroy any worker left over from a production visit or an older dev
      // session — a lingering cache-first worker serves stale chunks through
      // every refresh and makes development impossible to trust.
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => registrations.forEach((r) => void r.unregister()));
      }
      if ("caches" in window) {
        void caches.keys().then((keys) => keys.forEach((key) => void caches.delete(key)));
      }
      return;
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The site remains fully usable without the optional offline cache.
      });
    }
  }, []);
  return null;
}
