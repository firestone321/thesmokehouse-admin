"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useOrdersRealtime } from "@/components/ops/use-orders-realtime";
import type { OrdersRealtimeEvent } from "@/lib/ops/orders-realtime";
import type { DashboardIssueRecord, DashboardSnapshot, OrderListItem } from "@/lib/ops/types";
import { formatCurrency, formatDateTime, formatServiceDate } from "@/lib/ops/utils";

const RECONCILE_DEBOUNCE_MS = 150;
const DASHBOARD_ACTIVE_ORDERS_LIMIT = 100;
const DASHBOARD_TODAY_ORDERS_LIMIT = 100;
const activeOrderStatuses = new Set(["new", "confirmed", "in_prep", "ready"]);

type DashboardPayload =
  | {
      ok?: boolean;
      data?: {
        snapshot?: DashboardSnapshot;
      };
      message?: string;
    }
  | null;

type OrderPayload =
  | {
      ok?: boolean;
      data?: {
        order?: OrderListItem;
      };
      message?: string;
    }
  | null;

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

function sortOrders(orders: OrderListItem[]) {
  return [...orders].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function upsertCappedOrder(orders: OrderListItem[], order: OrderListItem, limit: number) {
  return sortOrders([order, ...orders.filter((candidate) => candidate.id !== order.id)]).slice(0, limit);
}

function removeOrder(orders: OrderListItem[], orderId: string) {
  return orders.filter((order) => String(order.id) !== orderId);
}

function getUgandaServiceDateFromTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function getNeedsActionPriority(order: OrderListItem) {
  if (order.fulfillmentReviewRequired) return -1;
  if (order.status === "ready") return 0;
  if (order.promisedAt && new Date(order.promisedAt).getTime() < Date.now()) return 1;
  if (order.status === "confirmed") return 2;
  if (order.status === "in_prep") return 3;
  return 4;
}

function getOverdueOrderIssues(orders: OrderListItem[]): DashboardIssueRecord[] {
  return orders
    .filter((order) => {
      if (!order.promisedAt) return false;
      if (order.status === "completed" || order.status === "cancelled") return false;
      if (order.paymentStatus !== "paid") return false;
      return new Date(order.promisedAt).getTime() < Date.now();
    })
    .slice(0, 3)
    .map((order) => ({
      id: `order-${order.id}`,
      title: `${order.orderNumber} is outside its promised window`,
      detail: order.itemSummary,
      severity: order.status === "ready" ? "critical" : "warning",
      owner: "Orders"
    }));
}

function getFulfillmentReviewIssues(orders: OrderListItem[]): DashboardIssueRecord[] {
  return orders
    .filter((order) => order.fulfillmentReviewRequired)
    .slice(0, 6)
    .map((order) => ({
      id: `fulfillment-review-${order.id}`,
      title: `${order.orderNumber} needs stock review`,
      detail:
        order.fulfillmentReviewReason ??
        order.stockReservationError ??
        "Payment succeeded, but stock was not reserved automatically.",
      severity: "critical",
      owner: "Orders",
      createdAt: order.createdAt
    }));
}

function rebuildDashboardSnapshot(
  current: DashboardSnapshot,
  activeOrders: OrderListItem[],
  todaysOrders: OrderListItem[]
): DashboardSnapshot {
  const inPrepOrders = activeOrders.filter((order) => order.status === "in_prep");
  const readyOrders = activeOrders.filter((order) => order.status === "ready");
  const reviewOrders = activeOrders.filter((order) => order.fulfillmentReviewRequired);
  const actionableOrders = activeOrders.filter((order) => order.status !== "new" || order.fulfillmentReviewRequired);
  const actionOrders = [...actionableOrders]
    .sort((left, right) => getNeedsActionPriority(left) - getNeedsActionPriority(right))
    .slice(0, 5);
  const revenueToday = todaysOrders
    .filter((order) => order.paymentStatus === "paid" && order.status !== "cancelled")
    .reduce((sum, order) => sum + order.totalAmount, 0);
  const issues = [
    ...getFulfillmentReviewIssues(activeOrders),
    ...current.incidents,
    ...getOverdueOrderIssues(activeOrders)
  ].slice(0, 6);

  return {
    ...current,
    generatedAt: new Date().toISOString(),
    metrics: {
      needsActionNow:
        actionOrders.length + reviewOrders.filter((order) => !actionOrders.some((actionOrder) => actionOrder.id === order.id)).length,
      inPrep: inPrepOrders.length,
      readyForPickup: readyOrders.length,
      lowStockPressure: current.lowStockItems.length,
      revenueToday,
      issuesNeedingAttention: issues.length
    },
    actionOrders,
    inPrepOrders,
    readyOrders,
    activeOrders,
    todaysOrders,
    issues
  };
}

async function fetchDashboardSnapshot() {
  const response = await fetch("/api/admin/dashboard", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as DashboardPayload;

  if (!response.ok || !payload?.ok || !payload.data?.snapshot) {
    throw new Error(payload?.message ?? "Unable to load dashboard.");
  }

  return payload.data.snapshot;
}

async function fetchOrderSnapshot(orderId: string) {
  const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as OrderPayload;

  if (response.status === 404) {
    return null;
  }

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? "Unable to load order.");
  }

  return payload.data?.order ?? null;
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
                {order.fulfillmentReviewRequired ? <span className="font-semibold text-[#A23B22]">stock review</span> : null}
              </div>
              {order.fulfillmentReviewRequired ? (
                <p className="mt-3 rounded-[18px] border border-[#F7D2B1] bg-[#FFF9F2] px-3 py-2 text-sm font-semibold leading-6 text-[#8A3F16]">
                  {order.fulfillmentReviewReason ?? order.stockReservationError ?? "Paid, but stock reservation needs review."}
                </p>
              ) : null}
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
  const [localSnapshot, setLocalSnapshot] = useState<DashboardSnapshot>(snapshot);
  const reconcileTimeoutsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setLocalSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    return () => {
      for (const timeoutId of reconcileTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }

      reconcileTimeoutsRef.current.clear();
    };
  }, []);

  const refreshDashboard = async () => {
    setLocalSnapshot(await fetchDashboardSnapshot());
  };

  const reconcileOrder = async (orderId: string) => {
    const order = await fetchOrderSnapshot(orderId);

    setLocalSnapshot((current) => {
      if (!order) {
        return rebuildDashboardSnapshot(current, removeOrder(current.activeOrders, orderId), removeOrder(current.todaysOrders, orderId));
      }

      const activeOrders = activeOrderStatuses.has(order.status)
        ? upsertCappedOrder(current.activeOrders, order, DASHBOARD_ACTIVE_ORDERS_LIMIT)
        : removeOrder(current.activeOrders, orderId);
      const todaysOrders =
        getUgandaServiceDateFromTimestamp(order.createdAt) === current.serviceDate
          ? upsertCappedOrder(current.todaysOrders, order, DASHBOARD_TODAY_ORDERS_LIMIT)
          : removeOrder(current.todaysOrders, orderId);

      return rebuildDashboardSnapshot(current, activeOrders, todaysOrders);
    });
  };

  const scheduleReconcile = (event: OrdersRealtimeEvent) => {
    if (event.type === "DELETE" && event.orderId) {
      setLocalSnapshot((current) =>
        rebuildDashboardSnapshot(current, removeOrder(current.activeOrders, event.orderId!), removeOrder(current.todaysOrders, event.orderId!))
      );
      return;
    }

    if (!event.orderId) {
      void refreshDashboard();
      return;
    }

    if (reconcileTimeoutsRef.current.has(event.orderId)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      reconcileTimeoutsRef.current.delete(event.orderId!);
      void reconcileOrder(event.orderId!);
    }, RECONCILE_DEBOUNCE_MS);

    reconcileTimeoutsRef.current.set(event.orderId, timeoutId);
  };

  useOrdersRealtime({
    source: "DashboardPage",
    autoRefresh: false,
    refreshOnFallback: false,
    onInsert: scheduleReconcile,
    onRefresh: scheduleReconcile
  });

  const generatedAt = formatDateTime(localSnapshot.generatedAt);

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
              <p className="mt-1 font-semibold text-[#111418]">{formatServiceDate(localSnapshot.serviceDate)}</p>
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
          value={localSnapshot.metrics.needsActionNow.toString()}
          supportingText="Orders still active and most urgent to move."
        />
        <MetricCard
          label="In prep"
          value={localSnapshot.metrics.inPrep.toString()}
          supportingText="Orders confirmed and actively being prepared."
        />
        <MetricCard
          label="Ready for pickup"
          value={localSnapshot.metrics.readyForPickup.toString()}
          supportingText="Orders marked ready and waiting on handoff."
        />
        <MetricCard
          label="Low stock pressure"
          value={localSnapshot.metrics.lowStockPressure.toString()}
          supportingText="Daily sellable stock rows currently below the low threshold."
        />
        <MetricCard
          label="Revenue today"
          value={formatCurrency(localSnapshot.metrics.revenueToday)}
          supportingText="Sum of live order totals created during the current Uganda service day."
        />
        <MetricCard
          label="Issues needing attention"
          value={localSnapshot.metrics.issuesNeedingAttention.toString()}
          supportingText="Open incidents plus overdue orders that need intervention."
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <OrderPanel eyebrow="Action now" title="Orders needing movement" orders={localSnapshot.actionOrders} />
          <div className="grid gap-4 2xl:grid-cols-2">
            <OrderPanel eyebrow="In prep" title="Orders being prepared" orders={localSnapshot.inPrepOrders} />
            <OrderPanel eyebrow="Ready for pickup" title="Ready and waiting" orders={localSnapshot.readyOrders} />
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
              {localSnapshot.lowStockItems.length > 0 ? (
                localSnapshot.lowStockItems.map((item) => (
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
                {localSnapshot.issues.length}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {localSnapshot.issues.length > 0 ? (
                localSnapshot.issues.map((issue) => (
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
