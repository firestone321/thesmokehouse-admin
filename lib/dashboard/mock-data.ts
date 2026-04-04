import { DashboardSeedData, DashboardOrder, InventoryAlert, SidebarNavItem } from "@/lib/dashboard/types";

export const sidebarNavItems: SidebarNavItem[] = [
  { label: "Dashboard", href: "/dashboard", description: "Operational overview" },
  { label: "Orders", href: "/orders", description: "Detailed order management" },
  { label: "Menu", href: "/menu", description: "Menu structure and pricing" },
  { label: "Inventory", href: "/inventory", description: "Stock levels and restock workflow" },
  { label: "Kitchen Queue", href: "/kitchen-queue", description: "Production sequencing" },
  { label: "Staff", href: "/staff", description: "Coverage and assignments" },
  { label: "Settings", href: "/settings", description: "Operational controls and policies" }
];

function buildTodayTimestamp(reference: Date, hours: number, minutes: number) {
  const value = new Date(reference);
  value.setHours(hours, minutes, 0, 0);
  return value.toISOString();
}

function createOrders(reference: Date): DashboardOrder[] {
  return [
    {
      id: "order-1401",
      orderNumber: "SH-1401",
      customerName: "Nanteza",
      items: [{ id: "item-1", name: "Fire-Grilled Turkey Wings", quantity: 2 }],
      status: "ready",
      total: 42000,
      createdAt: buildTodayTimestamp(reference, 8, 10),
      pickupTimeLabel: "Pickup by 12:15 PM",
      readyAt: buildTodayTimestamp(reference, 11, 25)
    },
    {
      id: "order-1402",
      orderNumber: "SH-1402",
      customerName: "Mayanja",
      items: [
        { id: "item-2", name: "Smoked Chicken", quantity: 2 },
        { id: "item-3", name: "Smoked Sausages", quantity: 1 }
      ],
      status: "smoking",
      total: 76000,
      createdAt: buildTodayTimestamp(reference, 7, 45),
      pickupTimeLabel: "Pickup by 12:45 PM",
      smokingStartedAt: buildTodayTimestamp(reference, 9, 5)
    },
    {
      id: "order-1403",
      orderNumber: "SH-1403",
      customerName: "Kato",
      items: [
        { id: "item-4", name: "Pork Ribs", quantity: 2 },
        { id: "item-5", name: "Beef Short Ribs", quantity: 1 }
      ],
      status: "smoking",
      total: 91000,
      createdAt: buildTodayTimestamp(reference, 8, 5),
      pickupTimeLabel: "Pickup by 1:10 PM",
      smokingStartedAt: buildTodayTimestamp(reference, 9, 40)
    },
    {
      id: "order-1404",
      orderNumber: "SH-1404",
      customerName: "Acen",
      items: [
        { id: "item-6", name: "Pork Belly", quantity: 1 },
        { id: "item-7", name: "Smoked Sausages", quantity: 2 }
      ],
      status: "ready",
      total: 68000,
      createdAt: buildTodayTimestamp(reference, 9, 0),
      pickupTimeLabel: "Pickup by 1:30 PM",
      readyAt: buildTodayTimestamp(reference, 11, 5)
    },
    {
      id: "order-1405",
      orderNumber: "SH-1405",
      customerName: "Namusoke",
      items: [{ id: "item-8", name: "Smoked Chicken", quantity: 3 }],
      status: "paid",
      total: 99000,
      createdAt: buildTodayTimestamp(reference, 10, 20),
      pickupTimeLabel: "Pickup by 2:00 PM"
    },
    {
      id: "order-1406",
      orderNumber: "SH-1406",
      customerName: "Walk-in customer",
      items: [
        { id: "item-9", name: "Pork Ribs", quantity: 2 },
        { id: "item-10", name: "Smoked Sausages", quantity: 1 }
      ],
      status: "paid",
      total: 84500,
      createdAt: buildTodayTimestamp(reference, 10, 55),
      pickupTimeLabel: "Pickup by 2:20 PM"
    },
    {
      id: "order-1407",
      orderNumber: "SH-1407",
      customerName: "Ssenfuma",
      items: [
        { id: "item-11", name: "Fire-Grilled Turkey Wings", quantity: 1 },
        { id: "item-12", name: "Sauce", quantity: 1 }
      ],
      status: "pending",
      total: 31000,
      createdAt: buildTodayTimestamp(reference, 11, 10),
      pickupTimeLabel: "Awaiting pickup timing confirmation"
    },
    {
      id: "order-1408",
      orderNumber: "SH-1408",
      customerName: "Atuheire",
      items: [{ id: "item-13", name: "Beef Short Ribs", quantity: 1 }],
      status: "pending",
      total: 47000,
      createdAt: buildTodayTimestamp(reference, 11, 32),
      pickupTimeLabel: "Pickup by 3:00 PM"
    },
    {
      id: "order-1400",
      orderNumber: "SH-1400",
      customerName: "Mwesigwa",
      items: [{ id: "item-14", name: "Smoked Chicken", quantity: 1 }],
      status: "delivered",
      total: 33000,
      createdAt: buildTodayTimestamp(reference, 6, 40),
      pickupTimeLabel: "Collected at 10:45 AM",
      readyAt: buildTodayTimestamp(reference, 10, 10)
    },
    {
      id: "order-1399",
      orderNumber: "SH-1399",
      customerName: "Auma",
      items: [{ id: "item-15", name: "Pork Belly", quantity: 1 }],
      status: "cancelled",
      total: 28000,
      createdAt: buildTodayTimestamp(reference, 6, 15),
      pickupTimeLabel: "Cancelled before payment"
    }
  ];
}

function createInventoryAlerts(): InventoryAlert[] {
  return [
    {
      id: "inv-1",
      name: "Charcoal",
      level: "critical",
      note: "Less than one smoker cycle remaining.",
      actionLabel: "Restock before evening shift"
    },
    {
      id: "inv-2",
      name: "Chicken",
      level: "low",
      note: "Reserve enough for two paid orders and one walk-in buffer.",
      actionLabel: "Confirm supplier delivery"
    },
    {
      id: "inv-3",
      name: "Sauce",
      level: "low",
      note: "Batch is running low for lunch pickup window.",
      actionLabel: "Prep another small batch"
    }
  ];
}

export function createDashboardSeedData(reference = new Date()): DashboardSeedData {
  return {
    orders: createOrders(reference),
    inventoryAlerts: createInventoryAlerts(),
    generatedAt: reference.toISOString()
  };
}
