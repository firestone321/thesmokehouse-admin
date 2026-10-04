// A separate scope keeps this test independent of the operational subscription.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  event.waitUntil(self.registration.showNotification("Smokehouse push test", {
    body: "A diagnostic push was received."
  }));
});
