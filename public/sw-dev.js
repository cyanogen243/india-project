// Dev-only self-destruct worker, served at /sw.js through a beforeFiles
// rewrite in next.config.ts. A cache-first worker registered by an old tab
// pins that tab to stale HTML/CSS/JS through every refresh, and the page-level
// cleanup in ServiceWorkerRegister.tsx never runs there because the stale
// cache never serves the new JS. The browser's service-worker update check is
// the one request that bypasses both the worker and its caches, so these
// bytes always reach a haunted tab: install immediately, wipe every cache,
// unregister, and reload each open tab.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) {
        client.navigate(client.url);
      }
    })(),
  );
});
