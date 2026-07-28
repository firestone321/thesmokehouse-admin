const CACHE_NAME = "smokehouse-admin-v2";
const OFFLINE_URL = "/offline";
const APP_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/logo-bigger.jpg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/logo-square.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedOfflinePage = await caches.match(OFFLINE_URL);
        return cachedOfflinePage || Response.error();
      })
    );
    return;
  }

  const isStaticAsset =
    requestUrl.origin === self.location.origin && ["style", "script", "image", "font", "manifest"].includes(request.destination);

  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkResponse = fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => cachedResponse || Response.error());

      return cachedResponse || networkResponse;
    })
  );
});

self.addEventListener("push", (event) => {
  const payload = (() => {
    if (!event.data) {
      return {};
    }

    try {
      return event.data.json();
    } catch {
      return {
        body: event.data.text()
      };
    }
  })();

  const title = typeof payload.title === "string" ? payload.title : "Smokehouse Admin";
  const notificationOptions = {
    body: typeof payload.body === "string" ? payload.body : "An order update is ready for review.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    data: payload.data && typeof payload.data === "object" ? payload.data : {}
  };

  event.waitUntil(self.registration.showNotification(title, notificationOptions));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const requestedUrl =
    event.notification.data && typeof event.notification.data.url === "string" ? event.notification.data.url : "/";
  const candidateUrl = new URL(requestedUrl, self.location.origin);
  const targetUrl = candidateUrl.origin === self.location.origin
    ? candidateUrl.href
    : new URL("/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      for (const client of clients) {
        if (client.url.startsWith(self.location.origin)) {
          if ("navigate" in client) {
            await client.navigate(targetUrl);
          }

          if ("focus" in client) {
            return client.focus();
          }
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
