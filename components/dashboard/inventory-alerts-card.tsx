import { InventoryAlert } from "@/lib/dashboard/types";

interface InventoryAlertsCardProps {
  alerts: InventoryAlert[];
}

const alertClasses: Record<InventoryAlert["level"], string> = {
  low: "bg-[#f7ead7] text-[#94672f]",
  critical: "bg-[#f9dfd8] text-[#a14538]"
};

export function InventoryAlertsCard({ alerts }: InventoryAlertsCardProps) {
  return (
    <section className="surface-card rounded-4xl p-5">
      <div className="border-b border-line/80 pb-4">
        <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Inventory Alerts</p>
        <h2 className="pt-2 text-xl font-semibold text-walnut">Low stock needing attention</h2>
        <p className="pt-2 text-sm leading-6 text-stone-600">
          Separate stock alerts from order actions so urgent prep decisions stay grounded in real kitchen capacity.
        </p>
      </div>

      <div className="space-y-3 pt-4">
        {alerts.map((alert) => (
          <article key={alert.id} className="rounded-3xl bg-sand px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-ink">{alert.name}</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${alertClasses[alert.level]}`}>
                {alert.level}
              </span>
            </div>
            <p className="pt-2 text-sm leading-6 text-stone-600">{alert.note}</p>
            {alert.actionLabel ? <p className="pt-2 text-sm font-medium text-walnut">{alert.actionLabel}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
