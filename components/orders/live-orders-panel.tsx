"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useOrdersRealtime } from "@/components/ops/use-orders-realtime";
import type { OrdersRealtimeEvent } from "@/lib/ops/orders-realtime";
import type { OrderListItem } from "@/lib/ops/types";
import { formatCurrency, formatDateTime } from "@/lib/ops/utils";

const RECONCILE_DEBOUNCE_MS = 150;

type OrdersPayload =
  | {
      ok?: boolean;
      data?: {
        orders?: OrderListItem[];
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

function getStatusClasses(status: string) {
  switch (status) {
    case "new":
      return "bg-[#FFF4E5] text-[#B45309]";
    case "confirmed":
      return "bg-[#E8F1FB] text-[#1D4ED8]";
    case "in_prep":
      return "bg-[#FFF7ED] text-[#C2410C]";
    case "ready":
      return "bg-[#ECFDF3] text-[#15803D]";
    case "completed":
      return "bg-[#F3F4F6] text-[#4B5563]";
    default:
      return "bg-[#FDECEC] text-[#D32F2F]";
  }
}

function getPaymentStatusClasses(paymentStatus: string) {
  switch (paymentStatus) {
    case "paid":
      return "bg-[#ECFDF3] text-[#15803D]";
    case "failed":
      return "bg-[#FFF4E5] text-[#B45309]";
    case "cancelled":
      return "bg-[#FDECEC] text-[#D32F2F]";
    default:
      return "bg-[#F3F4F6] text-[#4B5563]";
  }
}

function sortOrders(orders: OrderListItem[]) {
  return [...orders].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function orderMatchesFilters(order: OrderListItem, status: string, search: string) {
  if (status !== "all" && order.status !== status) {
    return false;
  }

  const normalizedSearch = search.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [order.orderNumber, order.customerName, order.customerPhone].some((value) =>
    String(value ?? "").toLowerCase().includes(normalizedSearch)
  );
}

async function fetchOrdersSnapshot(status: string, search: string, limit: number) {
  const params = new URLSearchParams({
    status,
    search,
    limit: String(limit)
  });
  const response = await fetch(`/api/admin/orders?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as OrdersPayload;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? "Unable to load orders.");
  }

  return payload.data?.orders ?? [];
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

export function LiveOrdersPanel({
  orders,
  status,
  search,
  limit
}: {
  orders: OrderListItem[];
  status: string;
  search: string;
  limit: number;
}) {
  const [localOrders, setLocalOrders] = useState<OrderListItem[]>(orders);
  const reconcileTimeoutsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setLocalOrders(orders);
  }, [orders]);

  useEffect(() => {
    return () => {
      for (const timeoutId of reconcileTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }

      reconcileTimeoutsRef.current.clear();
    };
  }, []);

  const removeOrder = (orderId: string) => {
    setLocalOrders((current) => current.filter((order) => String(order.id) !== orderId));
  };

  const upsertOrder = (order: OrderListItem) => {
    setLocalOrders((current) => {
      const next = orderMatchesFilters(order, status, search)
        ? [order, ...current.filter((candidate) => candidate.id !== order.id)]
        : current.filter((candidate) => candidate.id !== order.id);

      return sortOrders(next).slice(0, limit);
    });
  };

  const refreshOrders = async () => {
    const nextOrders = await fetchOrdersSnapshot(status, search, limit);
    setLocalOrders(nextOrders);
  };

  const reconcileOrder = async (orderId: string) => {
    const order = await fetchOrderSnapshot(orderId);

    if (!order) {
      removeOrder(orderId);
      return;
    }

    upsertOrder(order);
  };

  const scheduleReconcile = (event: OrdersRealtimeEvent) => {
    if (event.type === "DELETE" && event.orderId) {
      removeOrder(event.orderId);
      return;
    }

    if (!event.orderId) {
      void refreshOrders();
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
    source: "OrdersPage",
    autoRefresh: false,
    refreshOnFallback: false,
    onInsert: scheduleReconcile,
    onRefresh: scheduleReconcile
  });

  return (
    <section className="surface-card rounded-[32px] p-5">
      <div className="flex items-center justify-between gap-3 border-b border-[#EEF2F6] pb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Results</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">Orders</h2>
            <span className="rounded-full bg-[#ECFDF3] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#15803D]">
              live
            </span>
          </div>
        </div>
        <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold text-[#4B5563]">{localOrders.length}</span>
      </div>

      <div className="mt-4 space-y-3">
        {localOrders.length > 0 ? (
          localOrders.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="block rounded-[24px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_8px_18px_rgba(15,23,42,0.03)] transition hover:border-[#D0D7DE]"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{order.orderNumber}</h3>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${getStatusClasses(order.status)}`}>
                      {order.status.replace("_", " ")}
                    </span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${getPaymentStatusClasses(order.paymentStatus)}`}>
                      payment {order.paymentStatus}
                    </span>
                    {order.fulfillmentReviewRequired ? (
                      <span className="rounded-full bg-[#FFF1E8] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#A23B22]">
                        stock review
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-[#6B7280]">
                    {order.customerName ?? "Walk-in"}
                    {order.customerPhone ? ` | ${order.customerPhone}` : ""}
                  </p>
                  <p className="text-sm leading-6 text-[#6B7280]">{order.itemSummary}</p>
                  {order.fulfillmentReviewRequired ? (
                    <p className="max-w-2xl rounded-[18px] border border-[#F7D2B1] bg-[#FFF9F2] px-3 py-2 text-sm font-semibold leading-6 text-[#8A3F16]">
                      {order.fulfillmentReviewReason ?? order.stockReservationError ?? "Payment is paid, but stock reservation needs staff review."}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-3 text-sm text-[#6B7280] sm:grid-cols-3 lg:min-w-[420px]">
                  <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Created</p>
                    <p className="mt-1 font-semibold text-[#111418]">{formatDateTime(order.createdAt)}</p>
                  </div>
                  <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Promised</p>
                    <p className="mt-1 font-semibold text-[#111418]">{formatDateTime(order.promisedAt)}</p>
                  </div>
                  <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Total</p>
                    <p className="mt-1 font-semibold text-[#111418]">{formatCurrency(order.totalAmount)}</p>
                  </div>
                </div>
              </div>
            </Link>
          ))
        ) : (
          <div className="rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
            No live orders matched the current filter. Once orders exist in Supabase, they will appear here with their
            real status flow and event history.
          </div>
        )}
      </div>
    </section>
  );
}
