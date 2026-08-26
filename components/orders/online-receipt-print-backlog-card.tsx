"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CollapsibleCard } from "@/components/procurement/collapsible-card";
import { isThisDevicePosPrintStation } from "@/components/pwa/admin-push-auto-enrollment";
import { getAppServiceWorkerRegistration } from "@/lib/pwa/service-worker";
import type { OnlineReceiptPrintBacklogSnapshot, OnlineReceiptPrintJobPreview } from "@/lib/ops/types";
import { formatDateTime } from "@/lib/ops/utils";

function PrintJobRow({ job, canRetry }: { job: OnlineReceiptPrintJobPreview; canRetry: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  async function retry() {
    setIsRetrying(true);
    setMessage(null);
    try {
      const registration = await getAppServiceWorkerRegistration();
      const worker = registration?.active ?? navigator.serviceWorker.controller;
      if (!worker) throw new Error("The print worker is not ready yet. Refresh this PWA and try again.");
      worker.postMessage({ type: "smokehouse-retry-online-receipt-print-job", printJobId: job.id });
      setMessage("Retry sent to this printer station. The job will clear after Windows accepts it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start the print retry.");
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <article className="rounded-[18px] border border-[#E4E7EB] bg-white px-3 py-3 shadow-[0_8px_18px_rgba(15,23,42,0.03)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/orders/${job.orderId}`} className="text-sm font-semibold text-[#111418] hover:underline">
              Order #{job.orderId}
            </Link>
            <span className="rounded-full bg-[#FFF4E5] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#B45309]">
              pending print
            </span>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-[#6B7280] sm:grid-cols-2 sm:gap-x-5">
            <p>Created: {formatDateTime(job.createdAt)}</p>
            <p>Last attempt: {formatDateTime(job.lastAttemptAt)}</p>
          </div>
          {job.lastError ? <p className="mt-2 rounded-[14px] bg-[#FFF9F2] px-3 py-2 text-xs leading-5 text-[#8A3F16]">{job.lastError}</p> : null}
          {message ? <p className="mt-2 text-xs leading-5 text-[#4B5563]">{message}</p> : null}
        </div>
        <button
          type="button"
          disabled={!canRetry || isRetrying}
          onClick={() => { void retry(); }}
          className="shrink-0 rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
        >
          {isRetrying ? "Sending retry…" : "Retry print"}
        </button>
      </div>
    </article>
  );
}

export function OnlineReceiptPrintBacklogCard({ snapshot }: { snapshot: OnlineReceiptPrintBacklogSnapshot }) {
  const [isPrintStation, setIsPrintStation] = useState(false);

  useEffect(() => {
    const refresh = () => setIsPrintStation(isThisDevicePosPrintStation());
    refresh();
    window.addEventListener("smokehouse-pos-print-station-changed", refresh);
    return () => window.removeEventListener("smokehouse-pos-print-station-changed", refresh);
  }, []);

  const canRetry = isPrintStation && snapshot.printerStationRegistered;
  const collapsedMessage = snapshot.pendingCount > 0
    ? "Paid storefront receipts waiting for the designated printer PWA. Retrying never opens the cash drawer."
    : "No paid storefront receipt prints are waiting right now.";

  return (
    <CollapsibleCard
      eyebrow="Online orders"
      title="Print job backlog"
      count={snapshot.pendingCount}
      collapsedMessage={collapsedMessage}
    >
      {!snapshot.printerStationRegistered ? (
        <div className="rounded-[18px] border border-[#F7D2B1] bg-[#FFF9F2] px-3 py-3 text-sm leading-6 text-[#8A3F16]">
          No designated online-order printer station is registered. Enable it on the POS computer before retrying jobs.
        </div>
      ) : !isPrintStation ? (
        <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3 text-sm leading-6 text-[#6B7280]">
          Retries are available only on the designated POS printer computer. This device can view the backlog but cannot send a receipt to the local bridge.
        </div>
      ) : null}

      {snapshot.jobs.length > 0 ? (
        <div className="space-y-3">
          {snapshot.jobs.map((job) => <PrintJobRow key={job.id} job={job} canRetry={canRetry} />)}
        </div>
      ) : (
        <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3 text-sm leading-6 text-[#6B7280]">
          All online receipt jobs accepted by the bridge are cleared from this backlog.
        </div>
      )}
    </CollapsibleCard>
  );
}
