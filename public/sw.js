const CACHE_NAME = "smokehouse-admin-v3";
const OFFLINE_URL = "/offline";
const POS_PRINT_DB_NAME = "smokehouse-pos-print-jobs-v1";
const POS_PRINT_STORE = "jobs";
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

function openPosPrintDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(POS_PRINT_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(POS_PRINT_STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open local print-job storage."));
  });
}

async function readPosPrintJob(id) {
  const database = await openPosPrintDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(POS_PRINT_STORE, "readonly").objectStore(POS_PRINT_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Unable to read local print-job storage."));
  }).finally(() => database.close());
}

async function writePosPrintJob(job) {
  const database = await openPosPrintDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(POS_PRINT_STORE, "readwrite");
    transaction.objectStore(POS_PRINT_STORE).put(job);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to write local print-job storage."));
  }).finally(() => database.close());
}

async function listUnfinishedPosPrintJobs() {
  const database = await openPosPrintDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(POS_PRINT_STORE, "readonly").objectStore(POS_PRINT_STORE).getAll();
    request.onsuccess = () => resolve((request.result || []).filter((job) => job && job.status !== "accepted"));
    request.onerror = () => reject(request.error || new Error("Unable to list local print jobs."));
  }).finally(() => database.close());
}

async function reportPosPrintJobResult(printJobId, result) {
  await fetch(`/api/admin/pos/print-jobs/${encodeURIComponent(printJobId)}/result`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(result)
  });
}

async function processOnlineReceiptPrintJob(printJobId) {
  const previous = await readPosPrintJob(printJobId);
  if (previous && (previous.status === "accepted" || (previous.status === "sending" && Date.now() - previous.updatedAt < 60_000))) {
    return;
  }

  await writePosPrintJob({ id: printJobId, status: "sending", updatedAt: Date.now() });
  let job;
  try {
    const response = await fetch(`/api/admin/pos/print-jobs/${encodeURIComponent(printJobId)}`, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || !payload.ok) throw new Error(payload?.message || "Unable to load the receipt print job.");
    job = payload.data;
    if (job.completed) {
      await writePosPrintJob({ id: printJobId, status: "accepted", updatedAt: Date.now() });
      return;
    }

    const bridgeResponse = await fetch(`${job.bridgeUrl}/receipt/print`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${job.printAuthorization}`,
        "Idempotency-Key": printJobId
      },
      body: JSON.stringify(job.receipt)
    });
    const bridgePayload = await bridgeResponse.json().catch(() => null);
    if (!bridgeResponse.ok || !bridgePayload?.ok) throw new Error(bridgePayload?.error?.message || "Receipt printer rejected the request.");

    await reportPosPrintJobResult(printJobId, {
      status: "queued",
      bridgeResult: { status: String(bridgePayload.status || "queued"), detail: typeof bridgePayload.jobId === "string" ? bridgePayload.jobId : undefined }
    });
    await writePosPrintJob({ id: printJobId, status: "accepted", updatedAt: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Receipt print failed.";
    await writePosPrintJob({ id: printJobId, status: "failed", updatedAt: Date.now(), error: message });
    try {
      await reportPosPrintJobResult(printJobId, { status: "failed", error: message });
    } catch {
      // The bridge/job path is retried on a later event or PWA activation.
    }
  }
}

async function retryUnfinishedOnlineReceiptPrintJobs() {
  const jobs = await listUnfinishedPosPrintJobs();
  await Promise.all(jobs.slice(0, 3).map((job) => processOnlineReceiptPrintJob(job.id)));
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "smokehouse-retry-online-receipt-prints") {
    event.waitUntil(retryUnfinishedOnlineReceiptPrintJobs());
  }
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

  const printJobId = typeof payload.data?.onlineReceiptPrintJobId === "string" ? payload.data.onlineReceiptPrintJobId : null;
  const jobs = [self.registration.showNotification(title, notificationOptions)];
  if (printJobId) jobs.push(processOnlineReceiptPrintJob(printJobId));
  event.waitUntil(Promise.all(jobs));
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
