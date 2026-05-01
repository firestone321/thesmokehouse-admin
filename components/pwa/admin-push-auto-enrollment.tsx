"use client";

import { useEffect } from "react";
import { publicEnv } from "@/lib/public-env";
import {
  decodeVapidPublicKey,
  getAppServiceWorkerRegistration,
  supportsPushNotifications
} from "@/lib/pwa/service-worker";

function encodeVapidPublicKey(value: ArrayBuffer | null) {
  if (!value) {
    return "";
  }

  const binary = String.fromCharCode(...new Uint8Array(value));
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function subscriptionMatchesVapidKey(subscription: PushSubscription, publicKey: string) {
  const subscriptionKey = encodeVapidPublicKey(subscription.options.applicationServerKey);
  return subscriptionKey === publicKey;
}

async function saveAdminPushSubscription(subscription: PushSubscription) {
  const serialized = subscription.toJSON();
  const p256dh = serialized.keys?.p256dh;
  const auth = serialized.keys?.auth;

  if (!serialized.endpoint || !p256dh || !auth) {
    throw new Error("Push subscription is missing required keys.");
  }

  const response = await fetch("/api/admin/push/subscriptions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      endpoint: serialized.endpoint,
      expirationTime: serialized.expirationTime ?? null,
      keys: {
        p256dh,
        auth
      }
    })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Unable to save the admin notification subscription.");
  }
}

export function AdminPushAutoEnrollment() {
  async function createOrRefreshSubscription(registration: ServiceWorkerRegistration) {
    const existingSubscription = await registration.pushManager.getSubscription();

    if (existingSubscription && subscriptionMatchesVapidKey(existingSubscription, publicEnv.webPushVapidPublicKey)) {
      return existingSubscription;
    }

    if (existingSubscription) {
      await existingSubscription.unsubscribe();
    }

    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidPublicKey(publicEnv.webPushVapidPublicKey)
    });
  }

  useEffect(() => {
    let cancelled = false;

    const enroll = async () => {
      if (!supportsPushNotifications() || !publicEnv.webPushVapidPublicKey) {
        return;
      }

      if (Notification.permission === "denied") {
        return;
      }

      try {
        const permission =
          Notification.permission === "granted"
            ? "granted"
            : await Notification.requestPermission();

        if (cancelled || permission !== "granted") {
          return;
        }

        const registration = await getAppServiceWorkerRegistration();
        if (!registration) {
          return;
        }

        const subscription = await createOrRefreshSubscription(registration);

        if (!cancelled) {
          await saveAdminPushSubscription(subscription);
          void fetch("/api/admin/push/process", { method: "POST" }).catch((error) => {
            console.warn("admin_push_queue_kick_failed", error);
          });
        }
      } catch (error) {
        console.warn("admin_push_auto_enrollment_failed", error);
      }
    };

    void enroll();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
