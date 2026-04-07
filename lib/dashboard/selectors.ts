import {
  DashboardBoardStatus,
  DashboardOrder,
  DashboardStat,
  InventoryPressureItem,
  OrderActionDescriptor,
  OrderAlertFlag,
  ServiceAlert,
  dashboardBoardStatuses
} from "@/lib/dashboard/types";

const currencyFormatter = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0
});

const disabledActionReason =
  "Live order actions are intentionally disabled until authentication, audit logging, and server-side status mutations are wired.";

const alertPriority: Record<OrderAlertFlag, number> = {
  overdue: 0,
  blocked: 1,
  delayed: 2,
  low_stock: 3
};

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

function getPrimaryTime(order: DashboardOrder) {
  return new Date(order.promisedHandoffAt ?? order.estimatedFinishAt ?? order.readyAt ?? order.smokingStartedAt ?? order.createdAt).getTime();
}

function getPrimaryAlertWeight(order: DashboardOrder) {
  const weight = (order.alertFlags ?? []).reduce((current, flag) => Math.min(current, alertPriority[flag]), Number.POSITIVE_INFINITY);
  return Number.isFinite(weight) ? weight : 99;
}

function sortByPrimaryTime(left: DashboardOrder, right: DashboardOrder) {
  return getPrimaryTime(left) - getPrimaryTime(right);
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

export function formatTimeRangeLabel(fromTimestamp?: string | null, toTimestamp?: string | null) {
  if (!fromTimestamp && !toTimestamp) return "Timing pending";
  if (fromTimestamp && !toTimestamp) return formatTimeLabel(fromTimestamp);
  if (!fromTimestamp && toTimestamp) return formatTimeLabel(toTimestamp);
  return `${formatTimeLabel(fromTimestamp as string)} - ${formatTimeLabel(toTimestamp as string)}`;
}

export function getMinutesFromNow(targetTimestamp: string | null | undefined, now: Date) {
  if (!targetTimestamp) return null;
  return Math.round((new Date(targetTimestamp).getTime() - now.getTime()) / 60000);
}

export function formatDeltaLabel(targetTimestamp: string | null | undefined, now: Date, prefix: string) {
  const minutes = getMinutesFromNow(targetTimestamp, now);

  if (minutes === null) return `${prefix} pending`;

  if (minutes === 0) return `${prefix} now`;

  const absolute = Math.abs(minutes);
  const unit = absolute === 1 ? "min" : "mins";

  if (minutes > 0) return `${prefix} in ${absolute} ${unit}`;
  return `${prefix} ${absolute} ${unit} late`;
}

export function formatElapsedLabel(startedAt: string | null | undefined, now: Date) {
  if (!startedAt) return "Start time pending";

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
    accumulator[status] = orders.filter((order) => order.status === status).sort(sortByPrimaryTime);
    return accumulator;
  }, {} as Record<DashboardBoardStatus, DashboardOrder[]>);
}

export function getDashboardSummaryStats(
  orders: DashboardOrder[],
  alerts: ServiceAlert[],
  referenceNow: Date
): DashboardStat[] {
  const todaysOrders = orders.filter((order) => isSameDay(new Date(order.createdAt), referenceNow));
  const onSmoker = orders.filter((order) => order.status === "smoking");
  const readyForPickup = orders.filter((order) => order.status === "ready");
  const lowStockImpact = orders.filter((order) => (order.alertFlags ?? []).includes("low_stock"));
  const actionNow = getOrdersNeedingActionNow(orders);
  const revenueToday = todaysOrders
    .filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + order.total, 0);

  return [
    {
      label: "Needs action now",
      value: actionNow.length.toString().padStart(2, "0"),
      supportingText: `${alerts.filter((alert) => alert.level === "critical").length} critical service risks are open.`,
      tone: "accent",
      emphasis: "dominant"
    },
    {
      label: "On the smoker",
      value: onSmoker.length.toString().padStart(2, "0"),
      supportingText: `${onSmoker.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0)} proteins active now.`,
      tone: "success",
      emphasis: "standard"
    },
    {
      label: "Ready for pickup",
      value: readyForPickup.length.toString().padStart(2, "0"),
      supportingText: `${readyForPickup.filter((order) => (order.alertFlags ?? []).includes("overdue")).length} already outside target window.`,
      tone: "neutral",
      emphasis: "standard"
    },
    {
      label: "Low stock pressure",
      value: lowStockImpact.length.toString().padStart(2, "0"),
      supportingText: "Orders waiting on protein or fuel availability.",
      tone: "accent",
      emphasis: "standard"
    },
    {
      label: "Revenue today",
      value: formatCurrency(revenueToday),
      supportingText: `${todaysOrders.length} tickets logged this shift.`,
      tone: "neutral",
      emphasis: "quiet"
    }
  ];
}

export function getKitchenSmokingQueue(orders: DashboardOrder[]) {
  const grouped = new Map<string, { itemName: string; quantity: number; sourceOrderNumbers: string[] }>();

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

export function getOrdersNeedingActionNow(orders: DashboardOrder[]) {
  return orders
    .filter((order) => order.status === "paid" || order.status === "ready" || (order.alertFlags ?? []).length > 0)
    .sort((left, right) => {
      const alertDifference = getPrimaryAlertWeight(left) - getPrimaryAlertWeight(right);
      if (alertDifference !== 0) return alertDifference;
      return sortByPrimaryTime(left, right);
    })
    .slice(0, 4);
}

export function getOrdersOnSmoker(orders: DashboardOrder[]) {
  return orders.filter((order) => order.status === "smoking").sort(sortByPrimaryTime);
}

export function getReadyForPickupOrders(orders: DashboardOrder[]) {
  return orders.filter((order) => order.status === "ready").sort(sortByPrimaryTime);
}

export function getProductionQueue(orders: DashboardOrder[]) {
  return orders
    .filter((order) => order.status === "paid")
    .sort((left, right) => {
      const queuePositionDifference = (left.queuePosition ?? Number.MAX_SAFE_INTEGER) - (right.queuePosition ?? Number.MAX_SAFE_INTEGER);
      if (queuePositionDifference !== 0) return queuePositionDifference;
      return sortByPrimaryTime(left, right);
    });
}

export function getTopInventoryPressure(items: InventoryPressureItem[]) {
  return [...items].sort((left, right) => left.remainingKg / left.parKg - right.remainingKg / right.parKg).slice(0, 4);
}

export function getOperationalStatusText(order: DashboardOrder, now: Date) {
  if (order.status === "pending") {
    return "Awaiting payment confirmation. Keep off the prep board.";
  }

  if (order.status === "paid") {
    return order.holdReason ?? formatDeltaLabel(order.promisedHandoffAt, now, "Handoff");
  }

  if (order.status === "smoking") {
    return `${formatElapsedLabel(order.smokingStartedAt, now)}. ${formatDeltaLabel(order.estimatedFinishAt, now, "Finish")}.`;
  }

  return order.readyAt
    ? `Ready since ${formatTimeLabel(order.readyAt)}. ${formatDeltaLabel(order.promisedHandoffAt, now, "Pickup")}.`
    : "Ready for pickup. Waiting on runner handoff.";
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
      { label: "Load Pit", intent: "primary", disabledReason: disabledActionReason },
      { label: "Hold", intent: "secondary", disabledReason: disabledActionReason }
    ];
  }

  if (order.status === "smoking") {
    return [{ label: "Mark Ready", intent: "primary", disabledReason: disabledActionReason }];
  }

  return [{ label: "Complete Handoff", intent: "primary", disabledReason: disabledActionReason }];
}
