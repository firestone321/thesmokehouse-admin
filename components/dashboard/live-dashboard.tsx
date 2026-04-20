"use client";

import Link from "next/link";
import { useOrdersRealtime } from "@/components/ops/use-orders-realtime";
import type { DashboardSnapshot } from "@/lib/ops/types";
import { formatCurrency, formatDateTime, formatServiceDate } from "@/lib/ops/utils";

function MetricCard({
  label,
  value,
  supportingText
}: {
  label: string;
  value: string;
  supportingText: string;
}) {
  return (
    <article className="rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-[#111418]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-[#6B7280]">{supportingText}</p>
    </article>
  );
}

function OrderPanel({
  title,
  eyebrow,
  orders
}: {
  title: string;
  eyebrow: string;
  orders: DashboardSnapshot["actionOrders"];
}) {
  return (
    <section className="surface-card rounded-[32px] p-5">
      <div className="flex items-end justify-between gap-3 border-b border-[#EEF2F6] pb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold text-[#111418]">{title}</h2>
        </div>
        <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold text-[#4B5563]">{orders.length}</span>
      </div>
      <div className="mt-4 space-y-3">
        {orders.length > 0 ? (
          orders.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="block rounded-[24px] border border-[#E4E7EB] bg-white px-4 py-4 transition hover:border-[#D0D7DE]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[#111418]">{order.orderNumber}</h3>
                  <p className="text-sm text-[#6B7280]">{order.customerName ?? "Walk-in"}</p>
                </div>
                <p className="text-sm font-semibold text-[#111418]">{formatCurrency(order.totalAmount)}</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#6B7280]">{order.itemSummary}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-[#6B7280]">
                <span>{order.status.replace("_", " ")}</span>
                <span>{formatDateTime(order.promisedAt)}</span>
              </div>
            </Link>
          ))
        ) : (
          <div className="rounded-[24px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
            No live orders are in this lane right now.
          </div>
        )}
      </div>
    </section>
  );
}

export function LiveDashboard({ snapshot }: { snapshot: DashboardSnapshot }) {
  useOrdersRealtime({
    source: "DashboardPage"
  });

  const generatedAt = formatDateTime(snapshot.generatedAt);

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Dashboard</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold sm:text-3xl">Live smokehouse command view</h1>
              <span className="rounded-full bg-[#ECFDF3] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#15803D]">
                live
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              This page is now a real read model over orders, daily stock, and operational issues. It no longer uses
              dashboard-only mock arrays as a source of truth.
            </p>
          </div>

          <div className="grid gap-3 text-sm text-[#6B7280] sm:grid-cols-2">
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Service day</p>
              <p className="mt-1 font-semibold text-[#111418]">{formatServiceDate(snapshot.serviceDate)}</p>
            </div>
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Snapshot</p>
              <p className="mt-1 font-semibold text-[#111418]">{generatedAt}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Needs action now"
          value={snapshot.metrics.needsActionNow.toString()}
          supportingText="Orders still active and most urgent to move."
        />
        <MetricCard
          label="In prep"
          value={snapshot.metrics.inPrep.toString()}
          supportingText="Orders confirmed and actively being prepared."
        />
        <MetricCard
          label="Ready for pickup"
          value={snapshot.metrics.readyForPickup.toString()}
          supportingText="Orders marked ready and waiting on handoff."
        />
        <MetricCard
          label="Low stock pressure"
          value={snapshot.metrics.lowStockPressure.toString()}
          supportingText="Daily sellable stock rows currently below the low threshold."
        />
        <MetricCard
          label="Revenue today"
          value={formatCurrency(snapshot.metrics.revenueToday)}
          supportingText="Sum of live order totals created during the current Uganda service day."
        />
        <MetricCard
          label="Issues needing attention"
          value={snapshot.metrics.issuesNeedingAttention.toString()}
          supportingText="Open incidents plus overdue orders that need intervention."
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <OrderPanel eyebrow="Action now" title="Orders needing movement" orders={snapshot.actionOrders} />
          <div className="grid gap-4 2xl:grid-cols-2">
            <OrderPanel eyebrow="In prep" title="Orders being prepared" orders={snapshot.inPrepOrders} />
            <OrderPanel eyebrow="Ready for pickup" title="Ready and waiting" orders={snapshot.readyOrders} />
          </div>
        </div>

        <aside className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <div className="flex items-end justify-between gap-3 border-b border-[#EEF2F6] pb-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Low stock pressure</p>
                <h2 className="mt-2 text-xl font-semibold text-[#111418]">Today&apos;s tightest stock</h2>
              </div>
              <Link href="/inventory" className="text-sm font-semibold text-[#111418]">
                Inventory
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {snapshot.lowStockItems.length > 0 ? (
                snapshot.lowStockItems.map((item) => (
                  <article key={item.portionTypeId} className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-[#111418]">
                          {item.portionName}{item.portionLabel ? ` (${item.portionLabel})` : ""}
                        </h3>
                        <p className="text-sm text-[#6B7280]">
                          Remaining {item.remainingQuantity} of {item.startingQuantity}
                        </p>
                      </div>
                      <span className="rounded-full bg-[#FDECEC] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#D32F2F]">
                        low
                      </span>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                  No low-stock portion rows are currently flagged for today.
                </div>
              )}
            </div>
          </section>

          <section className="surface-card rounded-[32px] p-5">
            <div className="flex items-end justify-between gap-3 border-b border-[#EEF2F6] pb-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Issues</p>
                <h2 className="mt-2 text-xl font-semibold text-[#111418]">Needs attention</h2>
              </div>
              <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold text-[#4B5563]">
                {snapshot.issues.length}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {snapshot.issues.length > 0 ? (
                snapshot.issues.map((issue) => (
                  <article
                    key={issue.id}
                    className={`rounded-[22px] border px-4 py-4 ${
                      issue.severity === "critical" ? "border-[#F4C7C7] bg-[#FFF8F8]" : "border-[#F7D2B1] bg-[#FFF9F2]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-base font-semibold text-[#111418]">{issue.title}</h3>
                      <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#4B5563]">
                        {issue.owner}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#6B7280]">{issue.detail}</p>
                  </article>
                ))
              ) : (
                <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                  No live issues are currently open.
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
