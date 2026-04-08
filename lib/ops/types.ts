export const orderStatuses = ["new", "confirmed", "in_prep", "on_smoker", "ready", "completed", "cancelled"] as const;
export const prepTypes = ["smoked", "packed", "drink"] as const;
export const movementTypes = ["adjustment", "restock", "usage", "waste"] as const;

export type OrderStatus = (typeof orderStatuses)[number];
export type PrepType = (typeof prepTypes)[number];
export type InventoryMovementType = (typeof movementTypes)[number];

export interface InventoryItemRecord {
  id: number;
  code: string;
  name: string;
  unitName: string;
  currentQuantity: number;
  reorderThreshold: number;
  isActive: boolean;
  updatedAt: string;
  isLowStock: boolean;
}

export interface InventoryMovementRecord {
  id: number;
  inventoryItemId: number;
  movementType: InventoryMovementType;
  quantityDelta: number;
  resultingQuantity: number;
  note: string | null;
  createdAt: string;
}

export interface DailyStockRow {
  stockDate: string;
  portionTypeId: number;
  portionCode: string;
  portionName: string;
  portionLabel: string | null;
  proteinName: string | null;
  packagingTypeName: string | null;
  startingQuantity: number;
  reservedQuantity: number;
  soldQuantity: number;
  wasteQuantity: number;
  remainingQuantity: number;
  isInitialized: boolean;
  isLowStock: boolean;
}

export interface MenuCategoryRecord {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MenuComponentRecord {
  id: number;
  inventoryItemId: number;
  inventoryItemName: string;
  unitName: string;
  quantityRequired: number;
}

export interface MenuItemRecord {
  id: number;
  code: string;
  name: string;
  description: string | null;
  basePrice: number;
  prepType: PrepType;
  isActive: boolean;
  isAvailableToday: boolean;
  sortOrder: number;
  categoryId: number;
  categoryName: string;
  portionTypeId: number;
  portionLabel: string;
  components: MenuComponentRecord[];
}

export interface OrderListItem {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  status: OrderStatus;
  totalAmount: number;
  promisedAt: string | null;
  createdAt: string;
  notes: string | null;
  itemSummary: string;
  itemCount: number;
}

export interface OrderItemRecord {
  id: number;
  menuItemId: number;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderStatusEventRecord {
  id: number;
  eventType: "created" | "status_changed" | "note_added";
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  note: string | null;
  createdAt: string;
}

export interface OrderDetailRecord {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  status: OrderStatus;
  totalAmount: number;
  promisedAt: string | null;
  createdAt: string;
  notes: string | null;
  items: OrderItemRecord[];
  events: OrderStatusEventRecord[];
}

export interface DashboardIssueRecord {
  id: string;
  title: string;
  detail: string;
  severity: "warning" | "critical";
  owner: string;
  createdAt?: string | null;
}

export interface DashboardSnapshot {
  serviceDate: string;
  generatedAt: string;
  metrics: {
    needsActionNow: number;
    onSmoker: number;
    readyForPickup: number;
    lowStockPressure: number;
    revenueToday: number;
    issuesNeedingAttention: number;
  };
  actionOrders: OrderListItem[];
  smokerOrders: OrderListItem[];
  readyOrders: OrderListItem[];
  lowStockItems: DailyStockRow[];
  issues: DashboardIssueRecord[];
}
