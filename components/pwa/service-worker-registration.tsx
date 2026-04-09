"use client";

import { useEffect } from "react";
import { registerAppServiceWorker } from "@/lib/pwa/service-worker";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    void registerAppServiceWorker().catch((error) => {
      console.error("service_worker_registration_failed", error);
    });
  }, []);

  return null;
}
