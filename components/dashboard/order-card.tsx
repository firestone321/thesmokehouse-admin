import { DashboardOrder } from "@/lib/dashboard/types";
import { formatCurrency, formatOrderItems, getOperationalStatusText, getOrderActionDescriptors } from "@/lib/dashboard/selectors";

interface OrderCardProps {
  order: DashboardOrder;
  now: Date;
}

const statusClasses: Record<DashboardOrder["status"], string> = {
  pending: "bg-[#f8ecd8] text-[#8b612b]",
  paid: "bg-[#f5e6d8] text-[#8a5427]",
  smoking: "bg-[#f9dfcc] text-[#b05f25]",
  ready: "bg-[#e7f3e3] text-[#486a44]",
  delivered: "bg-stone-200 text-stone-700",
  cancelled: "bg-red-100 text-red-700"
};

const actionClasses = {
  primary: "bg-ember text-white",
  secondary: "bg-[#f1e3d4] text-walnut",
  danger: "bg-[#f9e0dc] text-[#9d4338]"
};

function getStatusLabel(status: DashboardOrder["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function OrderCard({ order, now }: OrderCardProps) {
  const actions = getOrderActionDescriptors(order);

  return (
    <article className="surface-card rounded-3xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Order</p>
          <h3 className="pt-1 text-lg font-semibold text-walnut">{order.orderNumber}</h3>
        </div>
        <span className={`badge-ring rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[order.status]}`}>
          {getStatusLabel(order.status)}
        </span>
      </div>

      <div className="pt-4">
        <p className="text-sm font-semibold text-ink">{formatOrderItems(order.items)}</p>
        <p className="pt-2 text-sm text-stone-600">
          {order.customerName ?? "Customer details pending"} / {order.pickupTimeLabel}
        </p>
        <p className="pt-2 text-sm text-stone-600">{formatCurrency(order.total)}</p>
      </div>

      <div className="mt-4 rounded-2xl bg-sand px-3 py-3">
        <p className="text-xs uppercase tracking-[0.16em] text-stone-500">Operational note</p>
        <p className="pt-2 text-sm leading-6 text-stone-700">{getOperationalStatusText(order, now)}</p>
      </div>

      <div className="pt-4">
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled
              title={action.disabledReason}
              className={`rounded-full px-4 py-2 text-sm font-semibold opacity-70 ${actionClasses[action.intent]}`}
            >
              {action.label}
            </button>
          ))}
        </div>
        <p className="pt-3 text-xs leading-5 text-stone-500">
          Actions are shown for workflow clarity only. Live state changes are not connected in phase 1.
        </p>
      </div>
    </article>
  );
}
