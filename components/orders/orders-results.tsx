"use client";
import Link from "next/link";
import type {ReactNode} from "react";
import {OrderItemsSummary} from "@/components/orders/order-items-display";
import type {OrderListItem} from "@/lib/ops/types";
import {formatCurrency,formatDateTime} from "@/lib/ops/utils";
function OrderRow({readOnly,href,children,...props}:{readOnly:boolean;href:string;children:ReactNode;className:string}){return readOnly?<article {...props}>{children}</article>:<Link href={href} {...props}>{children}</Link>;}
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


export function OrdersResults({orders,status,search,limit,page,hasNextPage,readOnly=false,sourceLabel="cached cloud",onPage}:{orders:OrderListItem[];status:string;search:string;limit:number;page:number;hasNextPage:boolean;readOnly?:boolean;sourceLabel?:string;onPage?:(page:number)=>void}){
  const buildPageUrl = (targetPage: number) => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (search) params.set("search", search);
    if (targetPage > 1) params.set("page", String(targetPage));
    return `/orders${params.size > 0 ? `?${params.toString()}` : ""}`;
  };

  return (
    <section className="surface-card rounded-[32px] p-5">
      <div className="flex items-center justify-between gap-3 border-b border-[#EEF2F6] pb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Results</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">Orders</h2>
            <span className="rounded-full bg-[#ECFDF3] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#15803D]">
              {readOnly?sourceLabel:"live"}
            </span>
          </div>
        </div>
        <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold text-[#4B5563]">{orders.length}</span>
      </div>

      <div className="mt-4 space-y-3">
        {orders.length > 0 ? (
          orders.map((order) => (
            <OrderRow readOnly={readOnly}
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
                  <OrderItemsSummary items={order.items} fallback={order.itemSummary} variant="orders-list" />
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
            </OrderRow>
          ))
        ) : (
          <div className="rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
            {readOnly?"No cached orders matched this filter. Full history requires connectivity.":"No live orders matched the current filter. Once orders exist in Supabase, they will appear here with their real status flow and event history."}
          </div>
        )}
      </div>

      {(page > 1 || hasNextPage) && (
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-[#EEF2F6] pt-4">
          {page > 1 ? (
            <Link
              href={buildPageUrl(page - 1)} onClick={readOnly?(e)=>{e.preventDefault();onPage?.(page-1);}:undefined}
              className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-2xl border border-[#E4E7EB] px-4 py-2.5 text-sm font-semibold text-[#9CA3AF]">Previous</span>
          )}
          <span className="text-sm text-[#6B7280]">Page {page}</span>
          {hasNextPage ? (
            <Link
              href={buildPageUrl(page + 1)} onClick={readOnly?(e)=>{e.preventDefault();onPage?.(page+1);}:undefined}
              className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-2xl border border-[#E4E7EB] px-4 py-2.5 text-sm font-semibold text-[#9CA3AF]">Next</span>
          )}
        </div>
      )}
    </section>
  );
}
