const REVISION = new URL(self.location.href).searchParams.get("v") || "local-v1";
const SAFE_REVISION = REVISION.replace(/[^a-z0-9_-]/gi, "").slice(0, 64);
const CACHE_PREFIX = "bund-forhelved-";
const STATIC_CACHE = `${CACHE_PREFIX}${SAFE_REVISION}-static`;
const PRECACHE_ASSETS = [
  "/offline-static.html",
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/notification-badge.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) => Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        )),
      self.registration.navigationPreload?.enable(),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() };
  }
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title || "bund forhelved", {
      body: payload.body || "Du har en ny notifikation.",
      icon: "/icons/icon-192.png",
      badge: "/icons/notification-badge.png",
      tag: payload.tag,
      data: { url: payload.url || "/venner" },
      vibrate: [100, 50, 100],
    }),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: "SOCIAL_NOTIFICATION" }));
    }),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "/venner", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) {
      if (new URL(client.url).href === destination) return client.focus();
    }
    return self.clients.openWindow(destination);
  }));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      event.preloadResponse
        .then((preloaded) => preloaded || fetch(request))
        .catch(() => caches.match("/offline-static.html")),
    );
    return;
  }

  const isStaticAsset = url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/icons/")
    || url.pathname === "/manifest.webmanifest"
    || url.pathname === "/offline-static.html";

  if (!isStaticAsset) return;

  const fresh = fetch(request);
  event.waitUntil(
    fresh
      .then((response) => {
        if (!response.ok) return undefined;
        return caches
          .open(STATIC_CACHE)
          .then((cache) => cache.put(request, response.clone()))
          .catch(() => undefined);
      })
      .catch(() => undefined),
  );
  event.respondWith(caches.match(request).then((cached) => cached || fresh));
});
