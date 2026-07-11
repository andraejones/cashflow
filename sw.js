// Service worker for Cashflow Calendar.
//
// Strategy: network-first with cache fallback. While online every request
// goes to the network (so a fresh deploy is picked up immediately — no cache
// version to bump); each successful response refreshes the cache, and the
// cache only serves when the network is unreachable. Only same-origin assets
// and Google Fonts are intercepted; GitHub API sync traffic passes through
// untouched.

const CACHE_NAME = "cashflow-static-v1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/build.js",
  "./js/utils.js",
  "./js/transaction-store.js",
  "./js/transaction-store-persistence.js",
  "./js/transaction-store-domains.js",
  "./js/transaction-store-allocations.js",
  "./js/recurring-manager.js",
  "./js/calculation-service.js",
  "./js/transaction-ui.js",
  "./js/transaction-ui-forms.js",
  "./js/transaction-ui-daydetail.js",
  "./js/transaction-ui-edit.js",
  "./js/transaction-ui-add.js",
  "./js/calendar-ui.js",
  "./js/search-ui.js",
  "./js/bank-reconcile.js",
  "./js/debt-snowball.js",
  "./js/debt-snowball-engine.js",
  "./js/debt-snowball-payments.js",
  "./js/debt-snowball-render.js",
  "./js/what-if.js",
  "./js/savings-goals.js",
  "./js/cloud-sync.js",
  "./js/pin-protection.js",
  "./js/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFontHost =
    url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFontHost) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && (response.ok || response.type === "opaque")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((hit) => {
          if (hit) return hit;
          if (request.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        })
      )
  );
});
