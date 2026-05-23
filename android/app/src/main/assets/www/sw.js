const CACHE_NAME = "spark-erp-phase1-v30";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=30",
  "./app.js?v=30",
  "./manifest.json",
  "./vendor/xlsx.full.min.js?v=1",
  "./assets/image1.png",
  "./assets/image2.png",
  "./assets/logo-pdf.jpg",
  "./assets/spark-logo.avif",
  "./assets/spark-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
