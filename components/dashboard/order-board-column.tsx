import { OrderCard } from "@/components/dashboard/order-card";
import { DashboardBoardStatus, DashboardOrder } from "@/lib/dashboard/types";

interface OrderBoardColumnProps {
  status: DashboardBoardStatus;
  orders: DashboardOrder[];
  now: Date;
}

const columnMeta: Record<DashboardBoardStatus, { label: string; description: string }> = {
  pending: {
    label: "Pending",
    description: "Awaiting payment confirmation. Keep these out of prep."
  },
  paid: {
    label: "Paid",
    description: "Payment cleared. Safe to schedule for smoking."
  },
  smoking: {
    label: "Smoking",
    description: "Active smoker work and timing to monitor."
  },
  ready: {
    label: "Ready",
    description: "Ready for pickup, not yet handed over."
  }
};

export function OrderBoardColumn({ status, orders, now }: OrderBoardColumnProps) {
  const meta = columnMeta[status];

  return (
    <section className="surface-card rounded-4xl p-4">
      <div className="flex items-center justify-between gap-3 border-b border-line/80 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-walnut">{meta.label}</h2>
          <p className="pt-1 text-sm leading-6 text-stone-600">{meta.description}</p>
        </div>
        <span className="rounded-full bg-sand px-3 py-1 text-sm font-semibold text-walnut">{orders.length}</span>
      </div>

      <div className="space-y-3 pt-4">
        {orders.length > 0 ? (
          orders.map((order) => <OrderCard key={order.id} order={order} now={now} />)
        ) : (
          <div className="rounded-3xl border border-dashed border-line bg-sand px-4 py-6 text-sm leading-6 text-stone-600">
            No orders in this stage right now.
          </div>
        )}
      </div>
    </section>
  );
}
