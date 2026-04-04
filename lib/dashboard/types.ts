export const dashboardOrderStatuses = ["pending", "paid", "smoking", "ready", "delivered", "cancelled"] as const;

export const dashboardBoardStatuses = ["pending", "paid", "smoking", "ready"] as const;

export type DashboardOrderStatus = (typeof dashboardOrderStatuses)[number];
export type DashboardBoardStatus = (typeof dashboardBoardStatuses)[number];
export type InventoryAlertLevel = "low" | "critical";
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
  smokingStartedAt?: string | null;
  readyAt?: string | null;
}

export interface InventoryAlert {
  id: string;
  name: string;
  level: InventoryAlertLevel;
  note: string;
  actionLabel?: string;
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

export interface DashboardSeedData {
  orders: DashboardOrder[];
  inventoryAlerts: InventoryAlert[];
  generatedAt: string;
}
