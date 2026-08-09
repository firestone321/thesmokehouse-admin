import Link from "next/link";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { OrderItemsSummary } from "@/components/orders/order-items-display";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getOrderHistoryPageData } from "@/lib/ops/queries";
import { formatCurrency, formatDateTime } from "@/lib/ops/utils";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";

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
  await requireApprovedAdminRole();
  const params = await searchParams;
  const search = getFirstValue(params.search) ?? "";
  const page = Math.max(1, parseInt(getFirstValue(params.page) ?? "1", 10) || 1);
  let data;

  try {
    data = await getOrderHistoryPageData({ search, page });
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Order history cannot load yet" error={error} />;
    }

    throw error;
  }

  const { orders, batches, page: currentPage, hasNextPage } = data;

  const buildPageUrl = (targetPage: number) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (targetPage > 1) params.set("page", String(targetPage));
    return `/orders/history${params.size > 0 ? `?${params.toString()}` : ""}`;
  };

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

          <div className="mt-2 divide-y divide-[#EEF2F6]">
            {orders.length > 0 ? (
              orders.map((order) => (
                <Link
                  key={order.id}
                  href={`/orders/${order.id}`}
                  className="block py-4 transition hover:bg-[#F8FAFB] -mx-5 px-5"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">{order.orderNumber}</h3>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.14em] ${getStatusClasses(order.status)}`}
                        >
                          {order.status.replace("_", " ")}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.14em] ${getPaymentStatusClasses(order.paymentStatus)}`}
                        >
                          payment {order.paymentStatus}
                        </span>
                      </div>

                      <p className="text-sm text-[#6B7280]">
                        {order.customerName ?? "Walk-in"}
                        {order.customerPhone ? ` | ${order.customerPhone}` : ""}
                      </p>

                      <OrderItemsSummary items={order.items} fallback={order.itemSummary} variant="orders-list" />

                      {order.notes ? (
                        <p className="text-sm italic leading-6 text-[#9CA3AF]">{order.notes}</p>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-sm text-[#6B7280] lg:min-w-[160px] lg:text-right">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-[#9CA3AF]">Created</p>
                      <p className="font-semibold text-[#111418]">{formatDateTime(order.createdAt)}</p>
                      <p className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-[#9CA3AF]">Pickup</p>
                      <p className="font-semibold text-[#111418]">{formatDateTime(order.promisedAt)}</p>
                      <p className="mt-2 text-base font-semibold text-[#111418]">{formatCurrency(order.totalAmount)}</p>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <p className="py-4 text-sm text-[#6B7280]">No archived orders match the current search.</p>
            )}
          </div>

          {(currentPage > 1 || hasNextPage) && (
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-[#EEF2F6] pt-4">
              {currentPage > 1 ? (
                <Link
                  href={buildPageUrl(currentPage - 1)}
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded-2xl border border-[#E4E7EB] px-4 py-2.5 text-sm font-semibold text-[#9CA3AF]">Previous</span>
              )}
              <span className="text-sm text-[#6B7280]">Page {currentPage}</span>
              {hasNextPage ? (
                <Link
                  href={buildPageUrl(currentPage + 1)}
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
