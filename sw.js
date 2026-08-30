const BUILD_VERSION = "__BUILD_VERSION__";
const CACHE_NAME = "zeitrechner-" + BUILD_VERSION;
const PRECACHE_ASSETS = /*__PRECACHE_ASSETS__*/ [
  "./index.html",
  "./src/app.css",
  "./src/calculator-core.js",
  "./src/state-store.js",
  "./src/app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];
const INDEX_URL = new URL("./index.html", self.registration.scope).href;
const PRECACHE_URLS = new Set(PRECACHE_ASSETS.map((asset) => new URL(asset, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("zeitrechner-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "GET_BUILD_VERSION" && event.ports[0]) {
    event.ports[0].postMessage({ version: BUILD_VERSION });
  }
});

async function cacheNavigation(request, event) {
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(INDEX_URL, copy)));
    }
    return response;
  } catch (error) {
    return (await caches.match(INDEX_URL)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return fetch(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(cacheNavigation(request, event));
    return;
  }
  if (PRECACHE_URLS.has(url.href)) event.respondWith(cacheFirst(request));
});
