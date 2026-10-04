"use client";

import { useEffect, useRef, useState } from "react";
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
  const serialized = subscription.toJSON();
  return subscriptionKey === publicKey && Boolean(serialized.endpoint && serialized.keys?.p256dh && serialized.keys?.auth);
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

  const enrollmentInFlight = useRef(false);

  async function createOrRefreshSubscription(registration: ServiceWorkerRegistration, publicKey: string) {
    const existingSubscription = await registration.pushManager.getSubscription();

    if (existingSubscription && subscriptionMatchesVapidKey(existingSubscription, publicKey)) {
      return existingSubscription;
    }

    if (existingSubscription) {
      const removed = await existingSubscription.unsubscribe();
      if (!removed) {
        throw new Error("Unable to replace the previous push subscription. Close and reopen the browser, then retry.");
      }
    }

    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidPublicKey(publicKey)
    });
  }

  async function enrollOnce(options?: { requestPermission?: boolean }) {
    if (!supportsPushNotifications()) {
      setStatus("unsupported");
      setMessage("This browser cannot receive push alerts.");
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

    let stage = "load_public_key";
    try {
      const response = await fetch("/api/admin/push/public-key", { cache: "no-store", headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => null) as { publicKey?: string; message?: string } | null;
      if (!response.ok || !payload?.publicKey) {
        throw new Error(payload?.message ?? "Unable to load notification configuration. Retry when connected.");
      }
      const publicKey = payload.publicKey;
      const decodedKey = decodeVapidPublicKey(publicKey);
      if (decodedKey.length !== 65 || decodedKey[0] !== 4) {
        throw new Error("Notification configuration has an invalid public key. Contact the administrator.");
      }
      stage = "service_worker";
      const registration = await getAppServiceWorkerRegistration();
      if (!registration) {
        throw new Error("Service worker registration is unavailable.");
      }

      stage = "subscribe";
      const subscription = await createOrRefreshSubscription(registration, publicKey);
      stage = "save_subscription";
      await saveAdminPushSubscription(subscription, isThisDevicePosPrintStation());
      registration.active?.postMessage({ type: "smokehouse-retry-online-receipt-prints" });
      void fetch("/api/admin/push/process", { method: "POST" }).catch((error) => {
        console.warn("admin_push_queue_kick_failed", error);
      });
      setStatus("active");
      setMessage(null);
    } catch (error) {
      console.warn("admin_push_auto_enrollment_failed", { stage, error });
      setStatus("error");
      const detail = error instanceof Error ? error.message : "Unable to set up order alerts.";
      setMessage(stage === "subscribe" && /could not retrieve the public key/i.test(detail)
        ? "Chrome could not create notification encryption keys. Fully close Chrome and any installed Smokehouse windows, reopen Chrome, then retry alerts. If this continues, try a new Chrome profile."
        : detail);
    }
  }

  async function enroll(options?: { requestPermission?: boolean }) {
    if (enrollmentInFlight.current) return;
    enrollmentInFlight.current = true;
    try {
      await enrollOnce(options);
    } finally {
      enrollmentInFlight.current = false;
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
          {status === "error" ? "Retry alerts" : "Enable alerts"}
        </button>
      ) : null}
    </div>
  );
}
