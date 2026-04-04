import { DashboardStatCard } from "@/components/dashboard/dashboard-stat-card";
import { InventoryAlertsCard } from "@/components/dashboard/inventory-alerts-card";
import { KitchenQueueCard } from "@/components/dashboard/kitchen-queue-card";
import { OrderBoardColumn } from "@/components/dashboard/order-board-column";
import { getDashboardSeedSnapshot } from "@/lib/dashboard/data-source";
import { getBoardOrdersByStatus, getDashboardSummaryStats, getKitchenSmokingQueue } from "@/lib/dashboard/selectors";
import { dashboardBoardStatuses } from "@/lib/dashboard/types";

export default async function DashboardPage() {
  const snapshot = await getDashboardSeedSnapshot();
  const referenceNow = new Date(snapshot.data.generatedAt);
  const summaryStats = getDashboardSummaryStats(snapshot.data.orders, referenceNow);
  const boardOrders = getBoardOrdersByStatus(snapshot.data.orders);
  const kitchenQueue = getKitchenSmokingQueue(snapshot.data.orders);
  const generatedLabel = new Intl.DateTimeFormat("en-UG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(referenceNow);

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-4xl p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Smokehouse dashboard</p>
            <h1 className="font-display pt-3 text-4xl text-walnut">Control room for today&apos;s service</h1>
            <p className="max-w-3xl pt-3 text-base leading-7 text-stone-600">
              This phase focuses on a dependable operator view: today&apos;s order load, which orders are safe to begin, what is already on the smoker, and what stock needs attention next.
            </p>
          </div>
          <div className="rounded-3xl bg-sand px-4 py-4 text-sm leading-6 text-stone-600 xl:max-w-sm">
            <p className="font-semibold text-walnut">Operational safety</p>
            <p className="pt-2">
              Actions are displayed for workflow clarity only. They stay disabled until live authentication, audit logging, and server mutations are wired.
            </p>
            <p className="pt-2">Data source: {snapshot.source}.</p>
            <p className="pt-2">{snapshot.note}</p>
            <p className="pt-2 text-xs uppercase tracking-[0.18em] text-stone-500">Snapshot generated {generatedLabel}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {summaryStats.map((stat) => (
          <DashboardStatCard key={stat.label} stat={stat} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="surface-card rounded-4xl p-5">
            <div className="flex flex-col gap-2 border-b border-line/80 pb-4">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Orders workflow board</p>
              <h2 className="text-xl font-semibold text-walnut">Track orders by operational stage</h2>
              <p className="text-sm leading-6 text-stone-600">
                Pending and paid orders remain visually distinct so staff do not start unpaid orders by mistake.
              </p>
            </div>

            <div className="grid gap-4 pt-4 xl:grid-cols-2 2xl:grid-cols-4">
              {dashboardBoardStatuses.map((status) => (
                <OrderBoardColumn key={status} status={status} orders={boardOrders[status]} now={referenceNow} />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <KitchenQueueCard entries={kitchenQueue} />
          <InventoryAlertsCard alerts={snapshot.data.inventoryAlerts} />
        </div>
      </section>
    </div>
  );
}
