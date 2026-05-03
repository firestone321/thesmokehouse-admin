"use client";

import Link from "next/link";
import { CollapsibleCard } from "@/components/procurement/collapsible-card";
import { processAdminPushQueueAction, processStorefrontReadyQueueAction } from "@/lib/ops/actions";
import type { PushQueueDispatchPreview, PushQueueSnapshot } from "@/lib/ops/types";
import { formatDateTime } from "@/lib/ops/utils";

function getStatusClasses(status: string) {
  switch (status) {
    case "pending":
    case "retry_due":
      return "bg-[#FFF4E5] text-[#B45309]";
    case "processing":
      return "bg-[#E8F1FB] text-[#1D4ED8]";
    case "stalled":
    case "failed":
      return "bg-[#FDECEC] text-[#D32F2F]";
    case "no_subscribers":
      return "bg-[#F3F4F6] text-[#4B5563]";
    default:
      return "bg-[#ECFDF3] text-[#15803D]";
  }
}

function getAction(queue: PushQueueSnapshot) {
  if (queue.key === "admin_paid_order") {
    return {
      label: "Process admin queue",
      action: processAdminPushQueueAction
    };
  }

  return {
    label: "Process Ready queue",
    action: processStorefrontReadyQueueAction
  };
}

function renderMetric(label: string, value: string | number) {
  return (
    <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">{label}</p>
      <p className="mt-1 font-semibold text-[#111418]">{value}</p>
    </div>
  );
}

function renderDispatch(dispatch: PushQueueDispatchPreview) {
  return (
    <div
      key={dispatch.id}
      className="rounded-[18px] border border-[#E4E7EB] bg-white px-3 py-3 shadow-[0_8px_18px_rgba(15,23,42,0.03)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/orders/${dispatch.orderId}`} className="text-sm font-semibold text-[#111418] hover:underline">
          Order #{dispatch.orderId}
        </Link>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusClasses(dispatch.status)}`}>
          {dispatch.status.replaceAll("_", " ")}
        </span>
        <span className="rounded-full bg-[#F3F4F6] px-2.5 py-1 text-[11px] font-semibold text-[#4B5563]">
          attempt {dispatch.attemptCount}
        </span>
      </div>
      <div className="mt-2 grid gap-2 text-xs text-[#6B7280] sm:grid-cols-2">
        <p>Created: {formatDateTime(dispatch.createdAt)}</p>
        <p>Next attempt: {formatDateTime(dispatch.nextAttemptAt)}</p>
        {dispatch.processingStartedAt ? <p>Processing since: {formatDateTime(dispatch.processingStartedAt)}</p> : null}
        {dispatch.lastAttemptAt ? <p>Last attempt: {formatDateTime(dispatch.lastAttemptAt)}</p> : null}
      </div>
      {dispatch.lastError ? (
        <p className="mt-2 rounded-[14px] bg-[#FFF9F2] px-3 py-2 text-xs leading-5 text-[#8A3F16]">{dispatch.lastError}</p>
      ) : null}
    </div>
  );
}

export function PushQueueHealthCard({
  queues,
  returnTo
}: {
  queues: PushQueueSnapshot[];
  returnTo: string;
}) {
  const openCount = queues.reduce((sum, queue) => sum + queue.openCount, 0);

  return (
    <CollapsibleCard
      eyebrow="Push queues"
      title="Notification backlog and retries"
      count={openCount}
      collapsedMessage="Shows both admin paid-order pushes and customer Ready pushes, including backlog, retry pressure, and one-click manual processing when traffic has gone quiet."
    >
      {queues.map((queue) => {
        const action = getAction(queue);

        return (
          <section key={queue.key} className="rounded-[24px] border border-[#E4E7EB] bg-white px-4 py-4">
            <div className="flex flex-col gap-4 border-b border-[#EEF2F6] pb-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-[#111418]">{queue.title}</h3>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                      queue.configured ? "bg-[#ECFDF3] text-[#15803D]" : "bg-[#FDECEC] text-[#D32F2F]"
                    }`}
                  >
                    {queue.configured ? "configured" : "needs env"}
                  </span>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">{queue.description}</p>
              </div>

              <form action={action.action} className="flex flex-col items-start gap-2">
                <input type="hidden" name="return_to" value={returnTo} />
                <button
                  type="submit"
                  disabled={!queue.configured}
                  className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
                >
                  {action.label}
                </button>
                <p className="text-xs text-[#6B7280]">
                  {queue.configured ? "Use this if pushes are waiting and normal traffic has gone quiet." : "This queue cannot be kicked until the required env values are present."}
                </p>
              </form>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {renderMetric("Open", queue.openCount)}
              {renderMetric("Due now", queue.dueNowCount)}
              {renderMetric("Retrying", queue.retryingCount)}
              {renderMetric("Stalled", queue.stalledCount)}
              {renderMetric("Failed", queue.failedCount)}
              {renderMetric("Subscriptions", queue.activeSubscriptionCount)}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {renderMetric("Oldest open", formatDateTime(queue.oldestOpenCreatedAt))}
              {renderMetric("Next attempt", formatDateTime(queue.nextAttemptAt))}
              {renderMetric("No subscribers", queue.noSubscribersCount)}
            </div>

            <div className="mt-4 space-y-3">
              {queue.recentDispatches.length > 0 ? (
                queue.recentDispatches.map(renderDispatch)
              ) : (
                <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3 text-sm leading-6 text-[#6B7280]">
                  No active or recently failed dispatches are showing right now.
                </div>
              )}
            </div>
          </section>
        );
      })}
    </CollapsibleCard>
  );
}
