"use client";

import { useEffect, useState } from "react";
import { publicEnv } from "@/lib/public-env";
import {
  decodeVapidPublicKey,
  getAppServiceWorkerRegistration,
  supportsPushNotifications
} from "@/lib/pwa/service-worker";

const POS_PRINT_STATION_STORAGE_KEY = "smokehouse-pos-print-station";

export function isThisDevicePosPrintStation() {
  return typeof window !== "undefined" && window.localStorage.getItem(POS_PRINT_STATION_STORAGE_KEY) === "true";
}

export function setThisDevicePosPrintStation(enabled: boolean) {
  window.localStorage.setItem(POS_PRINT_STATION_STORAGE_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new Event("smokehouse-pos-print-station-changed"));
}

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

async function saveAdminPushSubscription(subscription: PushSubscription, isPosPrintStation: boolean) {
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
      },
      isPosPrintStation
    })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? "Unable to save the admin notification subscription.");
  }
}

export function AdminPushAutoEnrollment() {
  const [status, setStatus] = useState<"checking" | "active" | "needs_permission" | "blocked" | "unsupported" | "not_configured" | "error">("checking");
  const [message, setMessage] = useState<string | null>(null);

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

  async function enroll(options?: { requestPermission?: boolean }) {
    if (!supportsPushNotifications()) {
      setStatus("unsupported");
      setMessage("This browser cannot receive push alerts.");
      return;
    }

    if (!publicEnv.webPushVapidPublicKey) {
      setStatus("not_configured");
      setMessage("Push alerts need VAPID config.");
      return;
    }

    if (Notification.permission === "denied") {
      setStatus("blocked");
      setMessage("Notifications are blocked in this browser.");
      return;
    }

    if (Notification.permission !== "granted") {
      if (!options?.requestPermission) {
        setStatus("needs_permission");
        setMessage("Allow alerts on this device to receive order updates.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "needs_permission");
        setMessage(
          permission === "denied"
            ? "Notifications are blocked in this browser."
            : "Allow alerts on this device to receive order updates."
        );
        return;
      }
    }

    setStatus("checking");
    setMessage("Setting up order alerts...");

    try {
      const registration = await getAppServiceWorkerRegistration();
      if (!registration) {
        throw new Error("Service worker registration is unavailable.");
      }

      const subscription = await createOrRefreshSubscription(registration);
      await saveAdminPushSubscription(subscription, isThisDevicePosPrintStation());
      registration.active?.postMessage({ type: "smokehouse-retry-online-receipt-prints" });
      void fetch("/api/admin/push/process", { method: "POST" }).catch((error) => {
        console.warn("admin_push_queue_kick_failed", error);
      });
      setStatus("active");
      setMessage(null);
    } catch (error) {
      console.warn("admin_push_auto_enrollment_failed", error);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to set up order alerts.");
    }
  }

  useEffect(() => {
    void enroll({ requestPermission: false });
    const refreshForStationChange = () => {
      void enroll({ requestPermission: false });
    };
    window.addEventListener("smokehouse-pos-print-station-changed", refreshForStationChange);
    return () => window.removeEventListener("smokehouse-pos-print-station-changed", refreshForStationChange);
  }, []);

  if (status === "active" || status === "checking") {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-[#2B211B]/15 bg-white px-4 py-3 text-sm font-semibold text-[#2B211B] shadow-[0_14px_35px_rgba(17,20,24,0.16)]">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8A6246]">Order alerts</p>
      {message ? <p className="mt-2 leading-5 text-[#5C4A3E]">{message}</p> : null}
      {status === "needs_permission" || status === "error" ? (
        <button
          type="button"
          onClick={() => {
            void enroll({ requestPermission: true });
          }}
          className="mt-3 rounded-md bg-[#2B211B] px-3 py-2 text-xs font-black uppercase tracking-wide text-white"
        >
          Enable alerts
        </button>
      ) : null}
    </div>
  );
}
