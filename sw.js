const CACHE_NAME = "saper-app-v6";
const APP_SHELL_FILES = [
  "./index.html",
  "./info.html",
  "./manifest.webmanifest",
  "./styles.css",
  "./info.css",
  "./script.js",
  "./info.js",
  "./info-settings-mock.js",
  "./shared-cookies.js",
  "./shared-daily-game-limit.js",
  "./shared-board-input.js",
  "./shared-minesweeper-utils.js",
  "./shared-sw-register.js",
  "./bomb.svg",
  "./bomb-black.svg",
  "./flag.svg",
  "./cross.svg",
  "./favicon-flag-light.svg",
  "./favicon-flag-dark.svg",
  "./apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      if (request.mode === "navigate") {
        return caches.match("./index.html");
      }
      throw new Error("Network request failed and no cache entry is available.");
    }
  })());
});
