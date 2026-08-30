import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { ReportsAnalytics } from "@/components/reports/reports-analytics";
import { DailyCloseReport } from "@/components/reports/daily-close-report";
import { FinancialTransfers } from "@/components/reports/financial-transfers";
import { requireDashboardRole } from "@/lib/auth/admin-role";
import { getAnalyticsSeries, getRevenueAnalyticsSeries } from "@/lib/analytics/queries";
import { getInventoryPageData, getProcurementPageData } from "@/lib/ops/queries";
import { formatCurrency, formatServiceDate, getUgandaServiceDate, getUgandaServiceDateOffset } from "@/lib/ops/utils";
import { getDailyCloseData } from "@/lib/reports/daily-close-data";
import { getFinancialSummary } from "@/lib/reports/financial-data";
import { getFinancialTransferData } from "@/lib/financial-transfers/data";


function getUgandaDateTimeLocal(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(reference);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}
function formatCount(value: number) {
  return new Intl.NumberFormat("en-UG").format(value);
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ date?: string; dailyCloseMessage?: string; transferMessage?: string }> }) {
  const params = await searchParams;
  const today = getUgandaServiceDate();
  const dailyCloseDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") && (params.date ?? "") <= today ? params.date! : today;
  const actor = await requireDashboardRole();
  if (actor.role !== "admin" && actor.role !== "manager") {
    redirect("/access-denied?message=Reports%20are%20available%20to%20managers%20and%20administrators%20only.");
  }

  const reportStartDate = getUgandaServiceDateOffset(-29);
  const reportEndDateExclusive = getUgandaServiceDateOffset(1);
  const [revenueSeries, orderSeries, inventory, procurement, dailyClose, financial, transfers] = await Promise.all([
    getRevenueAnalyticsSeries({ timeframe: "30d" }),
    getAnalyticsSeries({ metric: "orders", timeframe: "30d" }),
    getInventoryPageData(),
    getProcurementPageData(),
    getDailyCloseData(dailyCloseDate),
    getFinancialSummary(reportStartDate, reportEndDateExclusive),
    getFinancialTransferData(reportStartDate, reportEndDateExclusive)
  ]);

  const currentFinishedUnits = inventory.finishedStock.reduce((total, item) => total + item.currentQuantity, 0);
  const currentSupplyItems = inventory.inventoryItems.filter((item) => item.isActive).length;
  const lowStockCount = inventory.inventoryItems.filter((item) => item.isLowStock).length + inventory.dailyStock.filter((item) => item.isLowStock).length;

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Reports</p>
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Sales and operations insights</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B7280]">
              Read-only reporting for completed paid sales, current stock, procurement, and processing. All sales dates use Africa/Kampala.
            </p>
          </div>
          <span className="w-fit rounded-full bg-[#EEF7F0] px-3 py-2 text-xs font-semibold text-[#287241]">Admin and Manager only</span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[26px] border border-[#E3D2C6] bg-[#FFF9F4] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9A5F40]">Completed paid sales</p><p className="mt-3 text-3xl font-semibold">{formatCurrency(revenueSeries.total)}</p><p className="mt-2 text-sm text-[#6B7280]">{revenueSeries.range.label}, by completion time</p></article>
        <article className="rounded-[26px] border border-[#D3DDF3] bg-[#F4F7FF] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#46699B]">Orders created</p><p className="mt-3 text-3xl font-semibold">{formatCount(orderSeries.total)}</p><p className="mt-2 text-sm text-[#6B7280]">{orderSeries.range.label}; includes all statuses</p></article>
        <article className="rounded-[26px] border border-[#CCE4D2] bg-[#F3FBF5] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#287241]">Current finished stock</p><p className="mt-3 text-3xl font-semibold">{formatCount(currentFinishedUnits)}</p><p className="mt-2 text-sm text-[#6B7280]">Units across {formatCount(inventory.finishedStock.length)} sellable portions</p></article>
        <article className="rounded-[26px] border border-[#F0D9B8] bg-[#FFF9EE] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9A6A1B]">Stock attention</p><p className="mt-3 text-3xl font-semibold">{formatCount(lowStockCount)}</p><p className="mt-2 text-sm text-[#6B7280]">Low current inventory or service-day stock rows</p></article>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-[26px] border border-[#CCE4D2] bg-[#F3FBF5] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#287241]">Money In</p><p className="mt-3 text-3xl font-semibold">{formatCurrency(revenueSeries.total)}</p><p className="mt-2 text-sm text-[#6B7280]">Completed paid sales</p></article>
        <article className="rounded-[26px] border border-[#F0D9B8] bg-[#FFF9EE] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9A6A1B]">Money Out</p><p className="mt-3 text-3xl font-semibold">{formatCurrency(financial.moneyOut)}</p><p className="mt-2 text-sm text-[#6B7280]">Confirmed cash purchases from the ledger</p></article>
        <article className="rounded-[26px] border border-[#D3DDF3] bg-[#F4F7FF] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#46699B]">Net Cash Movement</p><p className="mt-3 text-3xl font-semibold">{formatCurrency(revenueSeries.total - financial.moneyOut)}</p><p className="mt-2 text-sm text-[#6B7280]">Money In minus Money Out</p></article>
      </section>

      <FinancialTransfers accounts={transfers.accounts} transfers={transfers.transfers} summary={transfers.summary} idempotencyKey={randomUUID()} defaultTransferredAt={getUgandaDateTimeLocal()} canRecord={actor.role === "admin" || actor.role === "manager"} message={params.transferMessage} />

      <ReportsAnalytics initialRevenue={revenueSeries} initialOrders={orderSeries} />

      <DailyCloseReport data={dailyClose} canSignOff={actor.role === "admin" || actor.role === "manager"} message={params.dailyCloseMessage} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="surface-card rounded-[32px] p-5"><p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Current stock</p><h2 className="mt-2 text-xl font-semibold">Finished portions and tracked supplies</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-[20px] bg-[#F8FAFB] p-4"><p className="text-sm font-semibold">{formatCount(inventory.finishedStock.length)} finished portions</p><p className="mt-1 text-sm text-[#6B7280]">Live frozen sellable balance</p></div><div className="rounded-[20px] bg-[#F8FAFB] p-4"><p className="text-sm font-semibold">{formatCount(currentSupplyItems)} tracked supply items</p><p className="mt-1 text-sm text-[#6B7280]">Current ingredient and supply quantities</p></div></div><p className="mt-4 text-xs leading-5 text-[#6B7280]">This is a current balance, not a reconstructed historical stock valuation.</p></section>
        <section className="surface-card rounded-[32px] p-5"><p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Latest operations</p><h2 className="mt-2 text-xl font-semibold">Procurement and processing</h2><div className="mt-4 space-y-3">{procurement.recentActivity.slice(0, 4).map((receipt) => <div key={receipt.id} className="rounded-[18px] border border-[#E4E7EB] bg-white px-4 py-3"><p className="text-sm font-semibold">{receipt.itemName}</p><p className="mt-1 text-xs text-[#6B7280]">{receipt.quantityReceived} {receipt.unitName} Ã‚Â· {receipt.supplierName ?? "Supplier not recorded"} Ã‚Â· {formatServiceDate(receipt.deliveryDate)}</p></div>)}{procurement.recentActivity.length === 0 ? <p className="rounded-[18px] bg-[#F8FAFB] px-4 py-4 text-sm text-[#6B7280]">No procurement receipts are available yet.</p> : null}</div><p className="mt-4 text-xs leading-5 text-[#6B7280]">{formatCount(procurement.recentProcessingBatches.length)} latest processing batches are available in the Resupplies workspace.</p></section>
      </div>

      <section className="rounded-[28px] border border-[#D8E1F4] bg-[#F5F8FF] p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#46699B]">Reporting boundary</p><p className="mt-2 max-w-4xl text-sm leading-6 text-[#4B5563]">Tender reconciliation, refunds, voids, discounts, tax, COGS, profit, and historical stock variance are intentionally not shown yet. Their required ledger data is not reliable until the corresponding backend workflows are live.</p></section>
    </div>
  );
}
