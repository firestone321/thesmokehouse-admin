import { notFound } from "next/navigation";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { addOrderNoteAction, completeOrderWithPickupCodeAction, updateOrderStatusAction } from "@/lib/ops/actions";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getAllowedNextStatuses, getOrderDetail } from "@/lib/ops/queries";
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

export default async function OrderDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orderId } = await params;
  const resolvedSearchParams = await searchParams;
  const errorParam = resolvedSearchParams.error;
  const errorMessage = Array.isArray(errorParam) ? errorParam[0] : errorParam;
  let order;

  try {
    order = await getOrderDetail(orderId);
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Order detail cannot load yet" error={error} />;
    }

    throw error;
  }

  if (!order) {
    notFound();
  }

  const allowedNextStatuses = getAllowedNextStatuses(order.status);

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Order detail</p>
        <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold sm:text-3xl">{order.orderNumber}</h1>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${getStatusClasses(order.status)}`}>
                {order.status.replace("_", " ")}
              </span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${getPaymentStatusClasses(order.paymentStatus)}`}>
                payment {order.paymentStatus}
              </span>
            </div>
            <p className="mt-2 text-sm text-[#6B7280]">
              {order.customerName ?? "Walk-in"}{order.customerPhone ? ` • ${order.customerPhone}` : ""}
            </p>
          </div>

          <div className="grid gap-3 text-sm text-[#6B7280] sm:grid-cols-3">
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
      </section>

      {errorMessage ? (
        <section className="rounded-[24px] border border-[#F4C7C7] bg-[#FFF8F8] px-5 py-4 text-sm leading-6 text-[#9F2D2D]">
          {errorMessage}
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Line items</p>
              <h2 className="mt-2 text-xl font-semibold">What this order contains</h2>
            </div>
            <div className="mt-4 space-y-3">
              {order.items.map((item) => (
                <article key={item.id} className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-[#111418]">{item.menuItemName}</h3>
                      <p className="mt-1 text-sm text-[#6B7280]">Qty {item.quantity}</p>
                    </div>
                    <div className="text-right text-sm text-[#6B7280]">
                      <p>{formatCurrency(item.unitPrice)} each</p>
                      <p className="mt-1 font-semibold text-[#111418]">{formatCurrency(item.lineTotal)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Event timeline</p>
              <h2 className="mt-2 text-xl font-semibold">Status and note history</h2>
            </div>
            <div className="mt-4 space-y-3">
              {order.events.map((event) => (
                <article key={event.id} className="rounded-[22px] border border-[#E4E7EB] bg-white px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[#111418]">
                      {event.eventType === "status_changed"
                        ? `${event.fromStatus?.replace("_", " ")} -> ${event.toStatus?.replace("_", " ")}`
                        : event.eventType.replace("_", " ")}
                    </p>
                    <p className="text-sm text-[#6B7280]">{formatDateTime(event.createdAt)}</p>
                  </div>
                  {event.note ? <p className="mt-2 text-sm leading-6 text-[#6B7280]">{event.note}</p> : null}
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Status actions</p>
              <h2 className="mt-2 text-xl font-semibold">Move this order forward</h2>
            </div>
            <div className="mt-4 space-y-3">
              {allowedNextStatuses.length > 0 ? (
                allowedNextStatuses.map((status) => (
                  status === "completed" ? (
                    <form key={status} action={completeOrderWithPickupCodeAction} className="space-y-3 rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
                      <input type="hidden" name="order_id" value={order.id} />
                      <div>
                        <p className="text-sm font-semibold text-[#111418]">Complete on pickup</p>
                        <p className="mt-1 text-sm leading-6 text-[#6B7280]">
                          Ask the customer to show the 4-digit code in their app, then enter it here. A correct code will mark the order completed automatically.
                        </p>
                      </div>
                      <label className="block space-y-2 text-sm text-[#6B7280]">
                        <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Pickup code</span>
                        <input
                          type="text"
                          name="pickup_code"
                          inputMode="numeric"
                          pattern="[0-9]{4}"
                          maxLength={4}
                          required
                          placeholder="1234"
                          className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                        />
                      </label>
                      {!order.pickupCode ? (
                        <p className="text-sm leading-6 text-[#9F2D2D]">
                          This order does not have a pickup code yet, so completion is currently blocked.
                        </p>
                      ) : null}
                      <button
                        type="submit"
                        disabled={!order.pickupCode}
                        className="w-full rounded-2xl bg-[#111418] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Verify code and complete
                      </button>
                    </form>
                  ) : (
                    <form key={status} action={updateOrderStatusAction}>
                      <input type="hidden" name="order_id" value={order.id} />
                      <input type="hidden" name="next_status" value={status} />
                      <button
                        type="submit"
                        className="w-full rounded-2xl bg-[#111418] px-4 py-3 text-sm font-semibold text-white"
                      >
                        {status === "in_prep"
                          ? "Mark in prep"
                          : status === "ready"
                            ? "Mark ready"
                            : `Mark as ${String(status).replace("_", " ")}`}
                      </button>
                    </form>
                  )
                ))
              ) : (
                <p className="rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                  This order is already in a terminal state and has no further status transitions.
                </p>
              )}
            </div>
          </section>

          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Notes</p>
              <h2 className="mt-2 text-xl font-semibold">Add an operational note</h2>
            </div>
            <form action={addOrderNoteAction} className="mt-4 space-y-3">
              <input type="hidden" name="order_id" value={order.id} />
              <textarea
                name="note"
                rows={5}
                required
                placeholder="What changed, what is blocked, or what handoff context should stay on this order?"
                className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-sm text-[#111418]"
              />
              <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
                Save note
              </button>
            </form>

            {order.notes ? (
              <div className="mt-4 rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Current note log</p>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#6B7280]">{order.notes}</p>
              </div>
            ) : null}

            {order.paymentStatus !== "paid" ? (
              <div className="mt-4 rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                Kitchen action stays locked until payment is verified. Once Pesapal marks this order paid, it will move
                into the confirmed queue automatically.
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
