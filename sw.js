const APP_CACHE = "translator-app-v6";
const MODEL_CACHE = "translator-models-v1";
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "fixes.js",
  "pinyin-pro.js",
  "manifest.webmanifest",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "worker/translator-worker.js",
  "worker/bergamot-translator-worker.js",
  "worker/bergamot-translator-worker.wasm",
];

self.addEventListener("install", (event) => {
  const requests = APP_FILES.map((file) => new Request(file, { cache: "reload" }));
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== APP_CACHE && name !== MODEL_CACHE).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request))
  );
});
