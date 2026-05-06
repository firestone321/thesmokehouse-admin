import Link from "next/link";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { PushQueueHealthCard } from "@/components/orders/push-queue-health-card";
import { LiveOrdersPanel } from "@/components/orders/live-orders-panel";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getOrdersPageData, getPushQueueSnapshots } from "@/lib/ops/queries";
import { processPendingPaymentRecoveriesAction } from "@/lib/ops/payment-recovery-actions";

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
  const pushQueueStatus = getFirstValue(params.push_queue_status);
  const pushQueueMessage = getFirstValue(params.push_queue_message);
  let data;
  let pushQueues;

  try {
    [data, pushQueues] = await Promise.all([
      getOrdersPageData({ status, search }),
      getPushQueueSnapshots()
    ]);
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Orders cannot load yet" error={error} />;
    }

    throw error;
  }

  const { orders, limit } = data;
  const returnToParams = new URLSearchParams();
  if (status !== "all") {
    returnToParams.set("status", status);
  }
  if (search) {
    returnToParams.set("search", search);
  }
  const returnTo = returnToParams.size > 0 ? `/orders?${returnToParams.toString()}` : "/orders";

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

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:min-w-[760px]">
            <Link
              href="/orders/history"
              className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]"
            >
              Order history
            </Link>

            <form action={processPendingPaymentRecoveriesAction}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                type="submit"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]"
              >
                Recover payments
              </button>
            </form>

            <form className="grid flex-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
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
        </div>
      </section>

      {pushQueueMessage ? (
        <section
          className={`rounded-[24px] px-4 py-4 text-sm leading-6 ${
            pushQueueStatus === "error"
              ? "border border-[#F7D2B1] bg-[#FFF9F2] text-[#8A3F16]"
              : "border border-[#D7E8DA] bg-[#F4FBF5] text-[#166534]"
          }`}
        >
          {pushQueueMessage}
        </section>
      ) : null}

      <PushQueueHealthCard queues={pushQueues} returnTo={returnTo} />
      <LiveOrdersPanel orders={orders} status={status} search={search} limit={limit} />
    </div>
  );
}
