"use client";

import { useState } from "react";
import Link from "next/link";
import { AnalyticsBarChart } from "@/components/dashboard/analytics-bar-chart";
import { OrderItemsSummary } from "@/components/orders/order-items-display";
import type { AnalyticsBucket } from "@/lib/analytics/types";
import type { OrderListItem } from "@/lib/ops/types";
import { formatCurrency, formatDateTime } from "@/lib/ops/utils";

function formatCount(value: number) {
  return new Intl.NumberFormat("en-UG").format(value);
}

function statusClassName(status: OrderListItem["status"]) {
  if (status === "completed" || status === "ready") return "bg-[#EEF7F0] text-[#287241]";
  if (status === "cancelled") return "bg-[#FFF1F1] text-[#9D2F2F]";
  if (status === "in_prep") return "bg-[#FFF8E8] text-[#8A5B12]";
  return "bg-[#EEF3F8] text-[#46699B]";
}

export function OrdersCreatedDrilldown({ buckets, rangeLabel }: { buckets: AnalyticsBucket[]; rangeLabel: string }) {
  const [selectedBucket, setSelectedBucket] = useState<AnalyticsBucket | null>(null);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function selectBucket(bucket: AnalyticsBucket) {
    setSelectedBucket(bucket);
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const params = new URLSearchParams({
        limit: "30",
        createdAtGte: bucket.startAt,
        createdAtLt: bucket.endAt
      });
      const response = await fetch(`/api/admin/orders?${params.toString()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        data?: { orders?: OrderListItem[]; hasNextPage?: boolean };
        message?: string;
      } | null;

      if (!response.ok || !payload?.ok || !payload.data?.orders) {
        throw new Error(payload?.message ?? "Unable to load orders for this period.");
      }

      setOrders(payload.data.orders);
      setHasNextPage(Boolean(payload.data.hasNextPage));
    } catch (error) {
      setOrders([]);
      setHasNextPage(false);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load orders for this period.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="surface-card rounded-[32px] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Order flow</p>
          <h2 className="mt-2 text-xl font-semibold">Orders created</h2>
          <p className="mt-1 text-sm text-[#6B7280]">Select a bar to see each order created in that Kampala time window.</p>
        </div>
        <p className="text-sm font-semibold">{rangeLabel}</p>
      </div>

      <div className="mt-5 rounded-[22px] border border-[#E4E7EB] bg-white p-4">
        <AnalyticsBarChart
          buckets={buckets}
          formatValue={formatCount}
          selectedBucketKey={selectedBucket?.key}
          onSelectBucket={selectBucket}
        />
      </div>

      {selectedBucket ? (
        <div className="mt-5 rounded-[22px] border border-[#D8E1F4] bg-[#F7FAFF] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Orders created on {selectedBucket.label}</p>
              <p className="mt-1 text-xs text-[#6B7280]">{formatCount(selectedBucket.value)} orders in this reporting bucket; all statuses are shown.</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#46699B]">{formatCount(orders.length)} loaded</span>
          </div>

          {isLoading ? <p className="mt-4 text-sm text-[#6B7280]">Loading individual orders…</p> : null}
          {errorMessage ? <p className="mt-4 text-sm text-[#9D2F2F]">{errorMessage}</p> : null}

          {!isLoading && !errorMessage && orders.length === 0 ? (
            <p className="mt-4 text-sm text-[#6B7280]">No orders were created in this period.</p>
          ) : null}

          {!isLoading && !errorMessage && orders.length > 0 ? (
            <div className="mt-4 space-y-3">
              {orders.map((order) => (
                <article key={order.id} className="rounded-[18px] border border-[#E4E7EB] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/orders/${order.id}`} className="text-sm font-semibold text-[#253B58] underline-offset-2 hover:underline">
                          {order.orderNumber || `Order #${order.id}`}
                        </Link>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClassName(order.status)}`}>{order.status.replaceAll("_", " ")}</span>
                      </div>
                      <p className="mt-1 text-sm text-[#6B7280]">{order.customerName || "Walk-in customer"} · {formatDateTime(order.createdAt)}</p>
                    </div>
                    <p className="text-base font-semibold">{formatCurrency(order.totalAmount)}</p>
                  </div>
                  <div className="mt-3 border-t border-[#EEF2F6] pt-3">
                    <OrderItemsSummary items={order.items} fallback={order.itemSummary} variant="orders-list" />
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {hasNextPage ? <p className="mt-4 text-xs leading-5 text-[#6B7280]">Showing the newest 30 orders in this period. Open Orders to view the rest.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
