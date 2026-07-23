const CACHE = "the-india-project-v2";
const ESSENTIAL = [
  "/",
  "/hi",
  "/updates",
  "/hi/updates",
  "/safety",
  "/hi/safety",
  "/legal",
  "/hi/legal",
  "/demands",
  "/hi/demands",
  "/timeline",
  "/hi/timeline",
  "/receipts",
  "/hi/receipts",
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
