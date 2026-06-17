const CACHE = "zeitrechner-v7";
const ASSETS = [
  "./index.html",
  "./src/calculator-core.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached && !cached.redirected) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok && !res.redirected) {
          caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
