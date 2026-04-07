export const dashboardOrderStatuses = ["pending", "paid", "smoking", "ready", "delivered", "cancelled"] as const;

export const dashboardBoardStatuses = ["pending", "paid", "smoking", "ready"] as const;

export type DashboardOrderStatus = (typeof dashboardOrderStatuses)[number];
export type DashboardBoardStatus = (typeof dashboardBoardStatuses)[number];
export type InventoryAlertLevel = "low" | "critical";
export type ServiceAlertLevel = "notice" | "warning" | "critical";
export type OrderAlertFlag = "low_stock" | "delayed" | "overdue" | "blocked";
export type PitStatusTone = "steady" | "watch" | "critical";
export type StatTone = "neutral" | "accent" | "success";
export type ActionIntent = "primary" | "secondary" | "danger";

export interface DashboardOrderItem {
  id: string;
  name: string;
  quantity: number;
}

export interface DashboardOrder {
  id: string;
  orderNumber: string;
  customerName?: string | null;
  items: DashboardOrderItem[];
  status: DashboardOrderStatus;
  total: number;
  createdAt: string;
  pickupTimeLabel: string;
  stageLabel?: string;
  promisedHandoffAt?: string | null;
  smokingStartedAt?: string | null;
  estimatedFinishAt?: string | null;
  stationAssignment?: string | null;
  queuePosition?: number | null;
  alertFlags?: OrderAlertFlag[];
  holdReason?: string | null;
  readyAt?: string | null;
}

export interface InventoryAlert {
  id: string;
  name: string;
  level: InventoryAlertLevel;
  note: string;
  actionLabel?: string;
  remainingKg?: number;
  parKg?: number;
  station?: string;
}

export interface SidebarNavItem {
  label: string;
  href: string;
  description: string;
}

export interface DashboardStat {
  label: string;
  value: string;
  supportingText: string;
  tone: StatTone;
  emphasis?: "dominant" | "standard" | "quiet";
}

export interface KitchenQueueEntry {
  itemName: string;
  quantity: number;
  sourceOrderNumbers: string[];
}

export interface OrderActionDescriptor {
  label: string;
  intent: ActionIntent;
  disabledReason: string;
}

export interface ServiceAlert {
  id: string;
  title: string;
  detail: string;
  level: ServiceAlertLevel;
  owner: string;
  dueLabel: string;
  orderNumber?: string;
}

export interface InventoryPressureItem {
  id: string;
  itemName: string;
  remainingKg: number;
  parKg: number;
  committedKg: number;
  station: string;
  nextDeliveryLabel: string;
  level: InventoryAlertLevel;
}

export interface PitStatus {
  id: string;
  name: string;
  temperatureLabel: string;
  loadLabel: string;
  nextCheckLabel: string;
  fuelLabel: string;
  note: string;
  tone: PitStatusTone;
}

export interface DashboardSeedData {
  orders: DashboardOrder[];
  inventoryAlerts: InventoryAlert[];
  serviceAlerts: ServiceAlert[];
  inventoryPressure: InventoryPressureItem[];
  pitStatuses: PitStatus[];
  generatedAt: string;
}
