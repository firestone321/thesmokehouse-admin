"use client";

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function supportsServiceWorker() {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

export function supportsPushNotifications() {
  return (
    typeof window !== "undefined"
    && supportsServiceWorker()
    && "PushManager" in window
    && "Notification" in window
  );
}

export async function registerAppServiceWorker() {
  if (!supportsServiceWorker()) {
    return null;
  }

  if (process.env.NODE_ENV !== "production") {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    return null;
  }

  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      registrationPromise = null;
      throw error;
    });
  }

  return registrationPromise;
}

export async function getAppServiceWorkerRegistration() {
  if (!supportsServiceWorker()) {
    return null;
  }

  const existingRegistration = await navigator.serviceWorker.getRegistration("/");
  if (!existingRegistration) {
    await registerAppServiceWorker();
  }

  return navigator.serviceWorker.ready;
}

export function decodeVapidPublicKey(publicKey: string) {
  const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
  const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);

  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
