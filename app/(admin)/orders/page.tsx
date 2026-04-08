import Link from "next/link";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getOrdersPageData } from "@/lib/ops/queries";
import { formatCurrency, formatDateTime } from "@/lib/ops/utils";

function getStatusClasses(status: string) {
  switch (status) {
    case "new":
      return "bg-[#FFF4E5] text-[#B45309]";
    case "confirmed":
      return "bg-[#E8F1FB] text-[#1D4ED8]";
    case "in_prep":
      return "bg-[#FFF7ED] text-[#C2410C]";
    case "on_smoker":
      return "bg-[#EEF2FF] text-[#4338CA]";
    case "ready":
      return "bg-[#ECFDF3] text-[#15803D]";
    case "completed":
      return "bg-[#F3F4F6] text-[#4B5563]";
    default:
      return "bg-[#FDECEC] text-[#D32F2F]";
  }
}

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrdersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = getFirstValue(params.status) ?? "all";
  const search = getFirstValue(params.search) ?? "";
  let data;

  try {
    data = await getOrdersPageData({ status, search });
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Orders cannot load yet" error={error} />;
    }

    throw error;
  }

  const { orders } = data;

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Orders</p>
        <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Live order flow</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              This list is now backed by Supabase orders, items, and status event history. Use filters to focus the
              active queue and open any order for the full timeline.
            </p>
          </div>

          <form className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
            <label className="space-y-2 text-sm text-[#6B7280]">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Status</span>
              <select
                name="status"
                defaultValue={status}
                className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
              >
                <option value="all">All statuses</option>
                <option value="new">New</option>
                <option value="confirmed">Confirmed</option>
                <option value="in_prep">In prep</option>
                <option value="on_smoker">On smoker</option>
                <option value="ready">Ready</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>

            <label className="space-y-2 text-sm text-[#6B7280]">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Search</span>
              <input
                type="search"
                name="search"
                defaultValue={search}
                placeholder="Order number, customer, phone"
                className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
              />
            </label>

            <button
              type="submit"
              className="self-end rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Apply
            </button>
          </form>
        </div>
      </section>

      <section className="surface-card rounded-[32px] p-5">
        <div className="flex items-center justify-between gap-3 border-b border-[#EEF2F6] pb-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Results</p>
            <h2 className="mt-2 text-xl font-semibold">Orders</h2>
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
                    </div>
                    <p className="text-sm text-[#6B7280]">
                      {order.customerName ?? "Walk-in"}{order.customerPhone ? ` • ${order.customerPhone}` : ""}
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
    </div>
  );
}
