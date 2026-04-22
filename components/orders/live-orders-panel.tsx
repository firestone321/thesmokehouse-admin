"use client";

import Link from "next/link";
import { useOrdersRealtime } from "@/components/ops/use-orders-realtime";
import type { OrderListItem } from "@/lib/ops/types";
import { formatCurrency, formatDateTime } from "@/lib/ops/utils";

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

export function LiveOrdersPanel({ orders }: { orders: OrderListItem[] }) {
  useOrdersRealtime({
    source: "OrdersPage"
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
        <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold text-[#4B5563]">{orders.length}</span>
      </div>

      <div className="mt-4 space-y-3">
        {orders.length > 0 ? (
          orders.map((order) => (
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
                  </div>
                  <p className="text-sm text-[#6B7280]">
                    {order.customerName ?? "Walk-in"}
                    {order.customerPhone ? ` | ${order.customerPhone}` : ""}
                  </p>
                  <p className="text-sm leading-6 text-[#6B7280]">{order.itemSummary}</p>
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
