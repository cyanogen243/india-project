const CACHE = "the-india-project-v6";
const ESSENTIAL = [
  "/",
  "/brand/compact-logo.png",
  "/brand/texture.webp",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
  "/hi",
  "/updates",
  "/hi/updates",
  "/safety",
  "/hi/safety",
  "/demands",
  "/hi/demands",
  "/timeline",
  "/hi/timeline",
  "/receipts",
  "/hi/receipts",
  "/resources",
  "/hi/resources",
  "/volunteer",
  "/hi/volunteer",
  "/text",
  "/hi/text",
  "/offline",
  "/offline.html",
  "/offline-pack/field-pack-en.pdf",
  "/offline-pack/field-pack-hi.pdf"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ESSENTIAL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Authentication and API responses must always come from the network.
  // Caching /api/admin would replay the signed-out response after login, while
  // caching an authenticated response could expose private workspace data.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/admin" ||
    url.pathname.startsWith("/admin/") ||
    url.searchParams.has("_rsc")
  ) {
    return;
  }

  if (url.pathname === "/feed/updates.json") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(
          async () =>
            (await caches.match(event.request)) ||
            (await caches.match("/offline.html")),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => caches.match("/offline.html")),
    ),
  );
});
