// Minimal service worker: show the offline page when a navigation fails.
self.addEventListener("install", (e) => e.waitUntil(caches.open("tofaa-v1").then((c) => c.add("/offline.html"))));
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
  }
});
