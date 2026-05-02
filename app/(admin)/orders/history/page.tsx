import Link from "next/link";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getOrderHistoryPageData } from "@/lib/ops/queries";
import { formatCurrency, formatDateTime } from "@/lib/ops/utils";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function getStatusClasses(status: string) {
  switch (status) {
    case "completed":
      return "bg-[#F3F4F6] text-[#4B5563]";
    case "cancelled":
      return "bg-[#FDECEC] text-[#D32F2F]";
    case "ready":
      return "bg-[#ECFDF3] text-[#15803D]";
    case "in_prep":
      return "bg-[#FFF7ED] text-[#C2410C]";
    case "confirmed":
      return "bg-[#E8F1FB] text-[#1D4ED8]";
    case "new":
      return "bg-[#FFF4E5] text-[#B45309]";
    default:
      return "bg-[#F3F4F6] text-[#4B5563]";
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

function parseDateValue(value: string) {
  return value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00+03:00`);
}

function formatBatchDate(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium"
  }).format(parseDateValue(value));
}

function formatElapsedSince(value: string) {
  const elapsedMs = Math.max(0, Date.now() - parseDateValue(value).getTime());
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${Math.max(1, minutes)}m`;
}

export default async function OrderHistoryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = getFirstValue(params.search) ?? "";
  let data;

  try {
    data = await getOrderHistoryPageData({ search });
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Order history cannot load yet" error={error} />;
    }

    throw error;
  }

  const { orders, batches } = data;

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Orders</p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Historical order archive</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Completed and cancelled orders live here with a batch archive beside them. This page stays server-rendered
              and follows the same admin role gate as the rest of the operations shell.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))] xl:min-w-[520px]">
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Archived orders</p>
              <p className="mt-1 font-semibold text-[#111418]">{orders.length}</p>
            </div>
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Batches shown</p>
              <p className="mt-1 font-semibold text-[#111418]">{batches.length}</p>
            </div>
            <Link
              href="/orders"
              className="rounded-[22px] border border-[#D7DDE4] bg-white px-4 py-3 font-semibold text-[#111418]"
            >
              Back to live orders
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <section className="surface-card rounded-[32px] p-5">
          <div className="flex flex-col gap-4 border-b border-[#EEF2F6] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Archived orders</p>
              <h2 className="mt-2 text-xl font-semibold">Previous orders and their detail pages</h2>
            </div>

            <form className="flex w-full gap-3 sm:max-w-md">
              <input
                type="search"
                name="search"
                defaultValue={search}
                placeholder="Order number, customer, phone"
                className="min-w-0 flex-1 rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
                Search
              </button>
            </form>
          </div>

          <div className="mt-4 space-y-3">
            {orders.length > 0 ? (
              orders.map((order) => (
                <Link
                  key={order.id}
                  href={`/orders/${order.id}`}
                  className="block rounded-[24px] border border-[#E4E7EB] bg-white px-4 py-4 transition hover:border-[#D0D7DE]"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">{order.orderNumber}</h3>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${getStatusClasses(
                            order.status
                          )}`}
                        >
                          {order.status.replace("_", " ")}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${getPaymentStatusClasses(
                            order.paymentStatus
                          )}`}
                        >
                          payment {order.paymentStatus}
                        </span>
                      </div>

                      <p className="text-sm text-[#6B7280]">
                        {order.customerName ?? "Walk-in"}
                        {order.customerPhone ? ` | ${order.customerPhone}` : ""}
                      </p>

                      <p className="text-sm leading-6 text-[#6B7280]">{order.itemSummary}</p>

                      {order.notes ? (
                        <p className="max-w-3xl rounded-[18px] border border-[#EEF2F6] bg-[#F8FAFB] px-3 py-2 text-sm leading-6 text-[#6B7280]">
                          {order.notes}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid gap-3 text-sm text-[#6B7280] sm:grid-cols-3 lg:min-w-[320px] lg:text-right">
                      <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3 lg:text-left">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Created</p>
                        <p className="mt-1 font-semibold text-[#111418]">{formatDateTime(order.createdAt)}</p>
                      </div>
                      <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3 lg:text-left">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Promised</p>
                        <p className="mt-1 font-semibold text-[#111418]">{formatDateTime(order.promisedAt)}</p>
                      </div>
                      <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3 lg:text-left">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Total</p>
                        <p className="mt-1 font-semibold text-[#111418]">{formatCurrency(order.totalAmount)}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
                No archived orders match the current search.
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Batch archive</p>
              <h2 className="mt-2 text-xl font-semibold">Batches being sold</h2>
            </div>

            <div className="mt-4 space-y-3">
              {batches.length > 0 ? (
                batches.map((batch) => (
                  <article key={batch.id} className="rounded-[24px] border border-[#E4E7EB] bg-white px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-[#111418]">{batch.receiptItemName}</h3>
                        <p className="mt-1 text-sm text-[#6B7280]">{batch.receiptSupplierName}</p>
                      </div>
                      <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#4B5563]">
                        {batch.receiptBatchNumber ?? "No batch"}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 text-sm text-[#6B7280] sm:grid-cols-2">
                      <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Received</p>
                        <p className="mt-1 font-semibold text-[#111418]">{formatBatchDate(batch.receivedAt)}</p>
                      </div>
                      <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Sold for</p>
                        <p className="mt-1 font-semibold text-[#111418]">{formatElapsedSince(batch.receivedAt)}</p>
                      </div>
                      <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Produced</p>
                        <p className="mt-1 font-semibold text-[#111418]">{batch.quantityProduced}</p>
                      </div>
                      <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Yield</p>
                        <p className="mt-1 font-semibold text-[#111418]">
                          {batch.yieldPercent === null ? "Not set" : `${batch.yieldPercent}%`}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#6B7280]">
                      <span className="rounded-full bg-[#F8FAFB] px-3 py-1">{batch.portionName}</span>
                      <span className="rounded-full bg-[#F8FAFB] px-3 py-1">{batch.portionCode || "Portion"}</span>
                    </div>

                    {batch.note ? <p className="mt-3 text-sm leading-6 text-[#6B7280]">{batch.note}</p> : null}
                  </article>
                ))
              ) : (
                <div className="rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
                  No processing batches were returned for the archive view.
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
