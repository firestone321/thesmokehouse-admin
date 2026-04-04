import {
  DashboardBoardStatus,
  DashboardOrder,
  DashboardStat,
  KitchenQueueEntry,
  OrderActionDescriptor,
  dashboardBoardStatuses
} from "@/lib/dashboard/types";

const currencyFormatter = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0
});

const disabledActionReason =
  "Live order actions are intentionally disabled until authentication, audit logging, and server-side status mutations are wired.";

export function isBoardStatus(status: DashboardOrder["status"]): status is DashboardBoardStatus {
  return dashboardBoardStatuses.includes(status as DashboardBoardStatus);
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function sortColumnOrders(left: DashboardOrder, right: DashboardOrder) {
  const leftTime = new Date(left.readyAt ?? left.smokingStartedAt ?? left.createdAt).getTime();
  const rightTime = new Date(right.readyAt ?? right.smokingStartedAt ?? right.createdAt).getTime();
  return leftTime - rightTime;
}

export function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

export function formatTimeLabel(isoTimestamp: string) {
  return new Intl.DateTimeFormat("en-UG", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(isoTimestamp));
}

export function formatElapsedLabel(startedAt: string | null | undefined, now: Date) {
  if (!startedAt) return "Smoking time pending";

  const elapsedMs = now.getTime() - new Date(startedAt).getTime();
  const totalMinutes = Math.max(0, Math.floor(elapsedMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m on smoker`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m on smoker`;
}

export function formatOrderItems(items: DashboardOrder["items"]) {
  return items.map((item) => `${item.name} x${item.quantity}`).join(", ");
}

export function getBoardOrdersByStatus(orders: DashboardOrder[]) {
  return dashboardBoardStatuses.reduce<Record<DashboardBoardStatus, DashboardOrder[]>>((accumulator, status) => {
    accumulator[status] = orders.filter((order) => order.status === status).sort(sortColumnOrders);
    return accumulator;
  }, {} as Record<DashboardBoardStatus, DashboardOrder[]>);
}

export function getDashboardSummaryStats(orders: DashboardOrder[], referenceNow: Date): DashboardStat[] {
  const todaysOrders = orders.filter((order) => isSameDay(new Date(order.createdAt), referenceNow));
  const activeOrders = orders.filter((order) => isBoardStatus(order.status));
  const smokingItems = orders
    .filter((order) => order.status === "smoking")
    .reduce((count, order) => count + order.items.reduce((inner, item) => inner + item.quantity, 0), 0);
  const revenueToday = todaysOrders
    .filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + order.total, 0);
  const readyCount = orders.filter((order) => order.status === "ready").length;

  return [
    {
      label: "Orders Today",
      value: todaysOrders.length.toString().padStart(2, "0"),
      supportingText: `${readyCount} awaiting pickup handoff.`,
      tone: "neutral"
    },
    {
      label: "Revenue Today",
      value: formatCurrency(revenueToday),
      supportingText: "Cancelled orders excluded from the total.",
      tone: "accent"
    },
    {
      label: "Active Orders",
      value: activeOrders.length.toString().padStart(2, "0"),
      supportingText: "Pending through ready, still requiring staff attention.",
      tone: "neutral"
    },
    {
      label: "Items Smoking",
      value: smokingItems.toString().padStart(2, "0"),
      supportingText: "Only items already in the smoking stage are counted.",
      tone: "success"
    }
  ];
}

export function getKitchenSmokingQueue(orders: DashboardOrder[]): KitchenQueueEntry[] {
  const grouped = new Map<string, KitchenQueueEntry>();

  for (const order of orders) {
    if (order.status !== "paid" && order.status !== "smoking") continue;

    for (const item of order.items) {
      const existing = grouped.get(item.name);

      if (existing) {
        existing.quantity += item.quantity;
        existing.sourceOrderNumbers.push(order.orderNumber);
      } else {
        grouped.set(item.name, {
          itemName: item.name,
          quantity: item.quantity,
          sourceOrderNumbers: [order.orderNumber]
        });
      }
    }
  }

  return [...grouped.values()].sort((left, right) => right.quantity - left.quantity || left.itemName.localeCompare(right.itemName));
}

export function getOperationalStatusText(order: DashboardOrder, now: Date) {
  if (order.status === "pending") {
    return "Awaiting payment confirmation. Do not start prep yet.";
  }

  if (order.status === "paid") {
    return "Paid and cleared to begin smoking when station capacity is available.";
  }

  if (order.status === "smoking") {
    return `${formatElapsedLabel(order.smokingStartedAt, now)}. Monitor until ready for handoff.`;
  }

  return order.readyAt
    ? `Ready since ${formatTimeLabel(order.readyAt)}. Awaiting pickup handoff.`
    : "Ready for pickup. Awaiting customer handoff.";
}

export function getOrderActionDescriptors(order: DashboardOrder): OrderActionDescriptor[] {
  if (order.status === "pending") {
    return [
      { label: "Approve", intent: "secondary", disabledReason: disabledActionReason },
      { label: "Cancel", intent: "danger", disabledReason: disabledActionReason }
    ];
  }

  if (order.status === "paid") {
    return [
      { label: "Start Smoking", intent: "primary", disabledReason: disabledActionReason },
      { label: "Cancel", intent: "danger", disabledReason: disabledActionReason }
    ];
  }

  if (order.status === "smoking") {
    return [{ label: "Mark as Ready", intent: "primary", disabledReason: disabledActionReason }];
  }

  return [{ label: "Delivered", intent: "primary", disabledReason: disabledActionReason }];
}
