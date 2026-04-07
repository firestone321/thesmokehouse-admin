import { getDashboardSeedSnapshot } from "@/lib/dashboard/data-source";
import {
  formatCurrency,
  formatDeltaLabel,
  formatElapsedLabel,
  formatOrderItems,
  formatTimeLabel,
  getDashboardSummaryStats,
  getOrdersNeedingActionNow,
  getOrdersOnSmoker,
  getProductionQueue,
  getReadyForPickupOrders,
  getTopInventoryPressure
} from "@/lib/dashboard/selectors";
import { DashboardOrder, DashboardStat, InventoryPressureItem, PitStatus, ServiceAlert } from "@/lib/dashboard/types";

const statClasses: Record<NonNullable<DashboardStat["emphasis"]>, string> = {
  dominant: "border-[#D7DDE4] bg-[#FFFFFF] text-[#111418]",
  standard: "border-[#E4E7EB] bg-[#FFFFFF] text-[#111418]",
  quiet: "border-[#E4E7EB] bg-[#F8FAFB] text-[#111418]"
};

const statToneClasses: Record<DashboardStat["tone"], string> = {
  neutral: "",
  accent: "ring-1 ring-[#ED6C02]/18",
  success: "ring-1 ring-[#2E7D32]/16"
};

const orderFlagClasses = {
  low_stock: "bg-[#FFF1E6] text-[#ED6C02]",
  delayed: "bg-[#FFF1E6] text-[#ED6C02]",
  overdue: "bg-[#FDECEC] text-[#D32F2F]",
  blocked: "bg-[#F3F4F6] text-[#6B7280]"
} as const;

const alertLevelClasses: Record<ServiceAlert["level"], string> = {
  critical: "border-[#F4C7C7] bg-[#FFF8F8] text-[#111418]",
  warning: "border-[#F7D2B1] bg-[#FFF9F2] text-[#111418]",
  notice: "border-[#E4E7EB] bg-[#F8FAFB] text-[#111418]"
};

const pitToneClasses: Record<PitStatus["tone"], string> = {
  steady: "border-[#CDE7CF] bg-[#F7FBF7]",
  watch: "border-[#F3D5B7] bg-[#FFF9F4]",
  critical: "border-[#F4C7C7] bg-[#FFF8F8]"
};

function getItemCount(order: DashboardOrder) {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

function formatWeight(value: number) {
  return `${value.toFixed(1)} kg`;
}

function formatFlagLabel(flag: keyof typeof orderFlagClasses) {
  return flag.replace("_", " ");
}

function StatCard({ stat }: { stat: DashboardStat }) {
  const emphasis = stat.emphasis ?? "standard";

  return (
    <article
      className={`rounded-[26px] border px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)] ${statClasses[emphasis]} ${statToneClasses[stat.tone]} ${
        emphasis === "dominant" ? "col-span-2 lg:col-span-2 xl:col-span-1" : ""
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">{stat.label}</p>
      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="text-2xl font-semibold text-[#111418] sm:text-3xl">{stat.value}</p>
        {emphasis === "dominant" ? (
          <span className="rounded-full bg-[#FDECEC] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#D32F2F]">
            Attention
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-5 text-[#6B7280] sm:leading-6">{stat.supportingText}</p>
    </article>
  );
}

function DetailCell({
  label,
  value,
  supportingText
}: {
  label: string;
  value: string;
  supportingText?: string;
}) {
  return (
    <div className="min-w-0 rounded-[18px] bg-[#F8FAFB] px-3 py-3">
      <p className="min-w-0 break-normal text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF] [overflow-wrap:normal] [word-break:normal]">
        {label}
      </p>
      <p className="mt-1 min-w-0 break-normal text-sm font-semibold text-[#111418] [overflow-wrap:normal] [word-break:normal]">
        {value}
      </p>
      {supportingText ? (
        <p className="mt-1 min-w-0 break-normal text-sm leading-5 text-[#6B7280] [overflow-wrap:normal] [word-break:normal]">
          {supportingText}
        </p>
      ) : null}
    </div>
  );
}

function CompactOrderCard({ order, now }: { order: DashboardOrder; now: Date }) {
  return (
    <article className="rounded-[24px] border border-[#E4E7EB] bg-[#FFFFFF] px-4 py-4 shadow-[0_6px_14px_rgba(15,23,42,0.03)]">
      <div className="min-w-0">
        <h3 className="min-w-0 break-normal text-base font-semibold text-[#111418] [overflow-wrap:normal] [word-break:normal] sm:text-lg">
          {order.items[0]?.name}
        </h3>
        <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[#6B7280]">{order.orderNumber}</p>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <DetailCell label="Station" value={order.stationAssignment ?? "Station pending"} />
        <DetailCell label="Status" value={order.stageLabel ?? order.status} />
        <DetailCell
          label="Promised"
          value={order.promisedHandoffAt ? formatTimeLabel(order.promisedHandoffAt) : order.pickupTimeLabel}
        />
        <DetailCell label="Quantity" value={`${getItemCount(order)} items`} supportingText={order.customerName ?? "House order"} />
      </div>

      {order.holdReason ? <p className="mt-3 text-sm leading-6 text-[#6B7280]">{order.holdReason}</p> : null}

      {(order.alertFlags ?? []).length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {(order.alertFlags ?? []).map((flag) => (
            <span
              key={flag}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${orderFlagClasses[flag]}`}
            >
              {formatFlagLabel(flag)}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-3 text-sm text-[#6B7280]">
        {order.status === "ready"
          ? formatDeltaLabel(order.promisedHandoffAt, now, "Pickup")
          : formatDeltaLabel(order.promisedHandoffAt, now, "Handoff")}
      </p>
    </article>
  );
}

function SmokerRow({ order, now }: { order: DashboardOrder; now: Date }) {
  const noteText = order.holdReason ?? formatDeltaLabel(order.estimatedFinishAt, now, "Finish");

  return (
    <article className="rounded-[26px] border border-[#E4E7EB] bg-[#FFFFFF] px-4 py-4 shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
      <div className="flex min-w-0 flex-col gap-4 2xl:grid 2xl:grid-cols-[minmax(260px,1.6fr)_minmax(0,1fr)] 2xl:items-start">
        <div className="min-w-0 2xl:pr-2">
          <h3 className="min-w-0 break-normal text-base font-semibold text-[#111418] [overflow-wrap:normal] [word-break:normal] sm:text-lg">
            {formatOrderItems(order.items)}
          </h3>

          {(order.alertFlags ?? []).length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {(order.alertFlags ?? []).map((flag) => (
                <span
                  key={flag}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${orderFlagClasses[flag]}`}
                >
                  {formatFlagLabel(flag)}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-2 md:grid-cols-2 2xl:grid-cols-[repeat(3,minmax(0,1fr))]">
          <DetailCell label="Order" value={order.orderNumber} />
          <DetailCell label="Pit / station" value={order.stationAssignment ?? "Station pending"} />
          <DetailCell label="Status" value={order.stageLabel ?? order.status} />
          <DetailCell
            label="Started"
            value={order.smokingStartedAt ? formatTimeLabel(order.smokingStartedAt) : "Pending"}
            supportingText={formatElapsedLabel(order.smokingStartedAt, now)}
          />
          <DetailCell
            label="Finish"
            value={order.estimatedFinishAt ? formatTimeLabel(order.estimatedFinishAt) : "Pending"}
            supportingText={formatDeltaLabel(order.estimatedFinishAt, now, "Finish")}
          />
          <DetailCell
            label="Promised handoff"
            value={order.promisedHandoffAt ? formatTimeLabel(order.promisedHandoffAt) : "Pending"}
            supportingText={order.pickupTimeLabel}
          />
          <DetailCell label="Quantity" value={`${getItemCount(order)} items`} supportingText={order.customerName ?? "House order"} />
          <div className="min-w-0 rounded-[18px] bg-[#F8FAFB] px-3 py-3 md:col-span-2 2xl:col-span-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Note</p>
            <p className="mt-1 min-w-0 break-normal text-sm leading-6 text-[#6B7280] [overflow-wrap:normal] [word-break:normal]">
              {noteText}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function InventoryPressureRow({ item }: { item: InventoryPressureItem }) {
  const ratio = Math.max(8, Math.min(100, Math.round((item.remainingKg / item.parKg) * 100)));
  const barClass = item.level === "critical" ? "bg-[#D32F2F]" : "bg-[#ED6C02]";

  return (
    <article className="rounded-[24px] border border-[#E4E7EB] bg-[#FFFFFF] px-4 py-4 shadow-[0_6px_14px_rgba(15,23,42,0.03)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#111418]">{item.itemName}</h3>
          <p className="text-sm text-[#6B7280]">{item.station}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
            item.level === "critical" ? "bg-[#FDECEC] text-[#D32F2F]" : "bg-[#FFF1E6] text-[#ED6C02]"
          }`}
        >
          {item.level}
        </span>
      </div>

      <div className="mt-4">
        <div className="h-2 rounded-full bg-[#EEF2F6]">
          <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${ratio}%` }} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm text-[#6B7280] sm:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Remaining</p>
          <p className="mt-1 font-semibold text-[#111418]">{formatWeight(item.remainingKg)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Committed</p>
          <p className="mt-1 font-semibold text-[#111418]">{formatWeight(item.committedKg)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Next inflow</p>
          <p className="mt-1 font-semibold text-[#111418]">{item.nextDeliveryLabel}</p>
        </div>
      </div>
    </article>
  );
}

function CriticalAlertCard({ alert }: { alert: ServiceAlert }) {
  return (
    <article className={`rounded-[24px] border px-4 py-4 ${alertLevelClasses[alert.level]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">{alert.owner}</p>
          <h3 className="mt-2 text-base font-semibold">{alert.title}</h3>
        </div>
        <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">
          {alert.dueLabel}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#6B7280]">{alert.detail}</p>
      {alert.orderNumber ? <p className="mt-3 text-sm font-semibold">{alert.orderNumber}</p> : null}
    </article>
  );
}

function PitStatusCard({ pit }: { pit: PitStatus }) {
  return (
    <article className={`rounded-[24px] border px-4 py-4 ${pitToneClasses[pit.tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[#111418]">{pit.name}</h3>
        <span className="text-sm font-semibold text-[#6B7280]">{pit.temperatureLabel}</span>
      </div>
      <div className="mt-3 grid gap-3 text-sm text-[#6B7280] sm:grid-cols-2">
        <p>{pit.loadLabel}</p>
        <p>{pit.fuelLabel}</p>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#6B7280]">{pit.note}</p>
      <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">{pit.nextCheckLabel}</p>
    </article>
  );
}

function PanelHeader({
  eyebrow,
  title,
  meta
}: {
  eyebrow: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pb-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">{eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold text-[#111418] sm:text-2xl">{title}</h2>
      </div>
      {meta ? <p className="text-sm text-[#6B7280]">{meta}</p> : null}
    </div>
  );
}

function AlertsPanel({ alerts }: { alerts: ServiceAlert[] }) {
  return (
    <section className="surface-card rounded-[32px] p-5">
      <PanelHeader eyebrow="Critical alerts" title="Issues needing attention" meta={`${alerts.length} open`} />
      <div className="space-y-3 border-t border-[#F0F2F5] pt-4">
        {alerts.map((alert) => (
          <CriticalAlertCard key={alert.id} alert={alert} />
        ))}
      </div>
    </section>
  );
}

function PitStatusPanel({ pits }: { pits: PitStatus[] }) {
  return (
    <section className="surface-card rounded-[32px] p-5">
      <PanelHeader eyebrow="Pit status" title="Chamber watch" />
      <div className="space-y-3 border-t border-[#F0F2F5] pt-4">
        {pits.map((pit) => (
          <PitStatusCard key={pit.id} pit={pit} />
        ))}
      </div>
    </section>
  );
}

function RevenuePanel({ revenueCard }: { revenueCard?: DashboardStat }) {
  return (
    <section className="rounded-[32px] border border-[#E4E7EB] bg-[#F8FAFB] p-5 text-[#111418] shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Revenue</p>
          <h2 className="mt-2 text-2xl font-semibold">{revenueCard?.value ?? formatCurrency(0)}</h2>
        </div>
        <span className="rounded-full bg-[#EEF2F6] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6B7280]">
          Secondary
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[#6B7280]">{revenueCard?.supportingText}</p>
    </section>
  );
}

export default async function DashboardPage() {
  const snapshot = await getDashboardSeedSnapshot();
  const referenceNow = new Date(snapshot.data.generatedAt);
  const summaryStats = getDashboardSummaryStats(snapshot.data.orders, snapshot.data.serviceAlerts, referenceNow);
  const actionNow = getOrdersNeedingActionNow(snapshot.data.orders);
  const smokerNow = getOrdersOnSmoker(snapshot.data.orders);
  const readyNow = getReadyForPickupOrders(snapshot.data.orders);
  const productionQueue = getProductionQueue(snapshot.data.orders);
  const inventoryPressure = getTopInventoryPressure(snapshot.data.inventoryPressure);
  const revenueCard = summaryStats.find((stat) => stat.label === "Revenue today");
  const generatedLabel = new Intl.DateTimeFormat("en-UG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(referenceNow);

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-4 py-5 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.26em] text-[#6B7280]">Dashboard</p>
            <h1 className="mt-2 text-2xl font-semibold text-[#111418] sm:text-3xl">Kitchen operations command center</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-[#6B7280]">
              <span className="rounded-full bg-[#F3F4F6] px-3 py-1">Lunch service</span>
              <span className="rounded-full bg-[#F3F4F6] px-3 py-1">3 pits online</span>
              <span className="rounded-full bg-[#F3F4F6] px-3 py-1">Mock feed</span>
            </div>
          </div>

          <div className="grid gap-3 text-sm text-[#6B7280] sm:grid-cols-3">
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Snapshot</p>
              <p className="mt-1 font-semibold text-[#111418]">{generatedLabel}</p>
            </div>
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Open tickets</p>
              <p className="mt-1 font-semibold text-[#111418]">
                {snapshot.data.orders.filter((order) => order.status !== "delivered" && order.status !== "cancelled").length}
              </p>
            </div>
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Muted actions</p>
              <p className="mt-1 font-semibold text-[#111418]">Read-only phase</p>
            </div>
          </div>
        </div>
      </section>

      <div className="xl:hidden">
        <AlertsPanel alerts={snapshot.data.serviceAlerts} />
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        {summaryStats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <PanelHeader eyebrow="On the smoker now" title="Active production loads" meta={`${smokerNow.length} live orders`} />
            <div className="space-y-3 border-t border-[#F0F2F5] pt-4">
              {smokerNow.map((order) => (
                <SmokerRow key={order.id} order={order} now={referenceNow} />
              ))}
            </div>
          </section>

          <section className="space-y-4 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:space-y-0 2xl:gap-4">
            <div className="surface-card rounded-[32px] p-5">
              <PanelHeader eyebrow="Ready for pickup" title="Hot hold and handoff" meta={`${readyNow.length} orders`} />
              <div className="space-y-3 border-t border-[#F0F2F5] pt-4">
                {readyNow.map((order) => (
                  <CompactOrderCard key={order.id} order={order} now={referenceNow} />
                ))}
              </div>
            </div>

            <div className="surface-card rounded-[32px] p-5">
              <PanelHeader eyebrow="Action now" title="Orders needing intervention" meta={`${actionNow.length} tickets`} />
              <div className="space-y-3 border-t border-[#F0F2F5] pt-4">
                {actionNow.map((order) => (
                  <CompactOrderCard key={order.id} order={order} now={referenceNow} />
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-4 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:space-y-0 2xl:gap-4">
            <div className="surface-card rounded-[32px] p-5">
              <PanelHeader eyebrow="Production queue" title="Next pit loads" meta={`${productionQueue.length} waiting`} />
              <div className="space-y-3 border-t border-[#F0F2F5] pt-4">
                {productionQueue.map((order) => (
                  <CompactOrderCard key={order.id} order={order} now={referenceNow} />
                ))}
              </div>
            </div>

            <div className="surface-card rounded-[32px] p-5">
              <PanelHeader eyebrow="Inventory pressure" title="Remaining meat stock by weight" meta="Tracked against lunch service par" />
              <div className="grid gap-3 border-t border-[#F0F2F5] pt-4 md:grid-cols-2 2xl:grid-cols-1">
                {inventoryPressure.map((item) => (
                  <InventoryPressureRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="hidden xl:block">
            <AlertsPanel alerts={snapshot.data.serviceAlerts} />
          </div>
          <PitStatusPanel pits={snapshot.data.pitStatuses} />
          <RevenuePanel revenueCard={revenueCard} />
        </aside>
      </div>
    </div>
  );
}
