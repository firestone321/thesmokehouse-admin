"use client";

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function supportsServiceWorker() {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

export function registerAppServiceWorker() {
  if (!supportsServiceWorker()) {
    return Promise.resolve(null);
  }

  if (process.env.NODE_ENV !== "production") {
    return navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      return null;
    });
  }

  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      registrationPromise = null;
      throw error;
    });
  }

  return registrationPromise;
}
