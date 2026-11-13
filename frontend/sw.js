/**
 * sw.js — caches the static app shell so the UI opens offline.
 *
 * Weather data is never cached here: those requests go to Open-Meteo and other
 * third-party origins, and weatherService keeps its own short-lived cache and
 * last-good snapshot for offline display.
 */
const CACHE_NAME = "meridian-shell-v16";
const SHELL_ASSETS = [
  "./",
  "index.html",
  "css/styles.css",
  "js/weatherService.js",
  "js/theme.js",
  "js/favorites.js",
  "js/search.js",
  "js/app.js",
  "js/mapLayers.js",
  "js/route.js",
  "js/journey.js",
  "js/intelligence.js",
  "js/airQuality.js",
  "js/astronomy.js",
  "js/windCompass.js",
  "js/weatherNarrative.js",
  "js/pressureTrend.js",
  "js/weatherEffects.js",
  "manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
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
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Third-party APIs and tiles (weather, radar, geocoding) always hit the network.
  if (url.origin !== self.location.origin) return;

  // Network first, cache as the offline fallback: a deployed change is picked
  // up on the next load instead of being pinned by an old shell.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("index.html")))
  );
});
