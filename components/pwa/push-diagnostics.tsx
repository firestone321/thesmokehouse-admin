"use client";

import { useRef, useState } from "react";
import { decodeVapidPublicKey } from "@/lib/pwa/service-worker";

export function PushDiagnostics() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setResults([]);
    const log = (text: string) => setResults((previous) => [...previous, text]);
    let stage = "browser_support";
    let registration: ServiceWorkerRegistration | undefined;
    try {
      log(`Browser: ${navigator.userAgent}`);
      log(`Secure context: ${window.isSecureContext}`);
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("This browser/context does not support push registration.");
      }
      stage = "permission";
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      log(`Notification permission: ${permission}`);
      if (permission !== "granted") throw new Error("Allow notifications before testing registration.");

      stage = "public_key";
      const response = await fetch("/api/admin/push/public-key", { cache: "no-store" });
      const payload = await response.json() as { publicKey?: string; message?: string };
      if (!response.ok || !payload.publicKey) throw new Error(payload.message ?? "Unable to load the server public key.");
      const key = decodeVapidPublicKey(payload.publicKey);
      log(`Server public key: ${key.length} bytes; uncompressed point: ${key[0] === 4}`);
      if (key.length !== 65 || key[0] !== 4) throw new Error("Invalid server public key format.");

      stage = "service_worker";
      registration = await navigator.serviceWorker.register("/push-diagnostics/sw.js", { scope: "/push-diagnostics/", updateViaCache: "none" });
      // navigator.serviceWorker.ready may resolve the operational root worker.
      // Wait specifically for the diagnostic registration instead.
      await new Promise<void>((resolve, reject) => {
        const deadline = window.setTimeout(() => { window.clearInterval(poll); reject(new Error("Diagnostic service worker activation timed out.")); }, 15000);
        const poll = window.setInterval(() => {
          if (registration?.active?.state === "activated") {
            window.clearTimeout(deadline);
            window.clearInterval(poll);
            resolve();
          }
        }, 100);
      });
      log(`Diagnostic worker active: ${registration.scope}`);
      stage = "existing_test_subscription";
      const existing = await registration.pushManager.getSubscription();
      if (existing && !await existing.unsubscribe()) throw new Error("Could not remove the previous diagnostic subscription.");
      stage = "subscribe";
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const p256dh = subscription.getKey("p256dh");
      const auth = subscription.getKey("auth");
      log(`Subscription created. p256dh: ${p256dh?.byteLength ?? 0} bytes; auth: ${auth?.byteLength ?? 0} bytes.`);
      if (!p256dh?.byteLength || !auth?.byteLength) throw new Error("Subscription returned incomplete encryption keys.");
      log("PASS: minimal browser registration succeeded. This does not test notification delivery.");
    } catch (error) {
      log(`FAIL at ${stage}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    } finally {
      // Clean up only the diagnostic scope; never touch the operational worker.
      if (registration) {
        try {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) log(`Diagnostic unsubscribe: ${await subscription.unsubscribe()}`);
          log(`Diagnostic worker removed: ${await registration.unregister()}`);
        } catch (error) {
          log(`Diagnostic cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6 text-[#2B211B]">
      <h1 className="text-2xl font-bold">Push registration test</h1>
      <p>Test Chrome with the current server key and a separate, basic service worker. The test creates a temporary subscription and removes it afterwards. It does not save a subscription to Smokehouse or send an order alert.</p>
      <p>Close other Smokehouse tabs and app windows first. Run this in the affected Chrome profile, then compare with Brave or Opera. Copy the results below when finished.</p>
      <button type="button" disabled={busy} onClick={() => void run()} className="rounded bg-[#2B211B] px-4 py-2 font-semibold text-white disabled:opacity-50">
        {busy ? "Testing?" : "Test notification registration"}
      </button>
      <pre aria-live="polite" className="whitespace-pre-wrap break-words rounded border bg-white p-4 text-sm">{results.join("\n") || "No test run yet."}</pre>
      <a href="/dashboard" className="block underline">Back to dashboard</a>
    </main>
  );
}
