import Link from "next/link";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { updateOrderStatusAction } from "@/lib/ops/actions";
import { formatDateTime } from "@/lib/ops/utils";
import { getOrdersPageData } from "@/lib/ops/queries";
import type { OrderListItem, OrderStatus } from "@/lib/ops/types";

const columns = [
  { status: "confirmed", label: "Queued for prep", description: "Paid orders waiting for the kitchen to start work.", nextStatus: "in_prep", actionLabel: "Start prep" },
  { status: "in_prep", label: "In prep", description: "Orders currently being cooked, packed, or assembled.", nextStatus: "ready", actionLabel: "Mark ready" },
  { status: "ready", label: "Ready for handoff", description: "Completed kitchen work waiting for pickup or counter handoff.", nextStatus: null, actionLabel: null }
] as const;

function getColumnOrders(orders: OrderListItem[], status: OrderStatus) {
  return orders.filter((order) => order.status === status);
}

function KitchenOrderCard({ order, nextStatus, actionLabel }: {
  order: OrderListItem;
  nextStatus: "in_prep" | "ready" | null;
  actionLabel: string | null;
}) {
  return (
    <article className="rounded-[24px] border border-[#E4E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Order</p>
          <h3 className="mt-1 text-lg font-semibold text-[#111418]">{order.orderNumber}</h3>
        </div>
        <Link href={`/orders/${order.id}`} className="text-sm font-semibold text-[#6B4F3A] underline-offset-4 hover:underline">
          Details
        </Link>
      </div>

      <div className="mt-4 rounded-[18px] bg-[#F8FAFB] px-3 py-3">
        <ul className="space-y-2 text-sm font-semibold text-[#111418]">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3">
              <span>{item.menuItemName}</span>
              <span className="shrink-0 text-[#6B7280]">x{item.quantity}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 space-y-1 text-sm text-[#6B7280]">
        <p><span className="font-semibold text-[#374151]">Customer:</span> {order.customerName ?? "Walk-in / name pending"}</p>
        <p><span className="font-semibold text-[#374151]">Handoff:</span> {order.promisedAt ? formatDateTime(order.promisedAt) : "Time not set"}</p>
        <p><span className="font-semibold text-[#374151]">Received:</span> {formatDateTime(order.createdAt)}</p>
      </div>

      {order.notes ? <p className="mt-4 rounded-[18px] bg-[#FFF9F2] px-3 py-3 text-sm leading-5 text-[#8A3F16]"><span className="font-semibold">Order note:</span> {order.notes}</p> : null}
      {order.fulfillmentReviewRequired ? (
        <p className="mt-4 rounded-[18px] bg-[#FEF2F2] px-3 py-3 text-sm leading-5 text-[#991B1B]">
          Stock review required{order.fulfillmentReviewReason ? `: ${order.fulfillmentReviewReason}` : "."}
        </p>
      ) : null}

      {nextStatus && actionLabel ? (
        <form action={updateOrderStatusAction} className="mt-4">
          <input type="hidden" name="order_id" value={order.id} />
          <input type="hidden" name="next_status" value={nextStatus} />
          <input type="hidden" name="return_to" value="/kitchen-queue" />
          <button
            type="submit"
            disabled={order.fulfillmentReviewRequired}
            className="w-full rounded-[18px] bg-[#111418] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#2A2F35] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {order.fulfillmentReviewRequired ? "Waiting for stock review" : actionLabel}
          </button>
        </form>
      ) : null}
    </article>
  );
}

export default async function KitchenQueuePage() {
  await requireApprovedAdminRole();

  let orders: OrderListItem[] = [];
  try {
    ({ orders } = await getOrdersPageData({
      status: ["confirmed", "in_prep", "ready"],
      excludeTerminalPosReady: true,
      limit: 30
    }));
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Kitchen queue cannot load yet" error={error} />;
    }

    throw error;
  }

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Chef workspace</p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Kitchen queue</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Work paid orders from left to right. Start prep when the kitchen takes the ticket, then mark it ready when the food is packed and ready for handoff.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-[#F8FAFB] px-3 py-2 text-sm font-semibold text-[#4B5563]">{orders.length} active</span>
            <Link href="/kitchen-queue" className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]">Refresh</Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {columns.map((column) => {
          const columnOrders = getColumnOrders(orders, column.status);
          return (
            <section key={column.status} className="surface-card rounded-[30px] p-4">
              <div className="flex items-start justify-between gap-3 border-b border-[#E4E7EB] pb-4">
                <div>
                  <h2 className="text-lg font-semibold">{column.label}</h2>
                  <p className="mt-1 text-sm leading-5 text-[#6B7280]">{column.description}</p>
                </div>
                <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-sm font-semibold text-[#374151]">{columnOrders.length}</span>
              </div>
              <div className="mt-4 space-y-3">
                {columnOrders.length > 0 ? columnOrders.map((order) => (
                  <KitchenOrderCard key={order.id} order={order} nextStatus={column.nextStatus} actionLabel={column.actionLabel} />
                )) : (
                  <div className="rounded-[22px] border border-dashed border-[#D7DDE4] px-4 py-8 text-center text-sm leading-6 text-[#6B7280]">
                    Nothing here right now.
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
