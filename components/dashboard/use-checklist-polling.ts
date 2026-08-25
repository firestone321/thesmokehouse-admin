"use client";

import { useEffect, useState } from "react";

const CHECKLIST_POLL_INTERVAL_MS = 60_000;

export function useChecklistPolling({
  pending,
  isEligible,
  refresh
}: {
  pending: boolean;
  isEligible: () => boolean;
  refresh: () => Promise<void>;
}) {
  const [clockRevision, setClockRevision] = useState(0);

  useEffect(() => {
    if (!pending) {
      return;
    }

    const wake = () => setClockRevision((current) => current + 1);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        wake();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    if (document.visibilityState !== "visible") {
      return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }

    if (!isEligible()) {
      const activationTimer = window.setTimeout(wake, CHECKLIST_POLL_INTERVAL_MS);
      return () => {
        window.clearTimeout(activationTimer);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      };
    }

    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && isEligible()) {
        void refresh();
      }
    }, CHECKLIST_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [clockRevision, isEligible, pending, refresh]);
}
