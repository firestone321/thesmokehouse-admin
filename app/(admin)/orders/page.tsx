import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { LiveOrdersPanel } from "@/components/orders/live-orders-panel";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getOrdersPageData } from "@/lib/ops/queries";

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
              This list is now backed by Supabase orders, items, payment state, and status event history. Paid orders
              enter the kitchen flow automatically, so staff only need to pick them up at prep time.
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

      <LiveOrdersPanel orders={orders} />
    </div>
  );
}
