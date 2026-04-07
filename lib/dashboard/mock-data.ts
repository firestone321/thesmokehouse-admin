import {
  DashboardOrder,
  DashboardSeedData,
  InventoryAlert,
  InventoryPressureItem,
  PitStatus,
  ServiceAlert,
  SidebarNavItem
} from "@/lib/dashboard/types";

export const sidebarNavItems: SidebarNavItem[] = [
  { label: "Dashboard", href: "/dashboard", description: "Live service board" },
  { label: "Orders", href: "/orders", description: "Tickets and handoff flow" },
  { label: "Menu", href: "/menu", description: "Proteins, trays, sides" },
  { label: "Inventory", href: "/inventory", description: "Meat, fuel, packaging" },
  { label: "Kitchen Queue", href: "/kitchen-queue", description: "Prep and smoker load plan" },
  { label: "Staff", href: "/staff", description: "Stations and shift coverage" },
  { label: "Settings", href: "/settings", description: "Controls and guardrails" }
];

function buildTodayTimestamp(reference: Date, hours: number, minutes: number) {
  const value = new Date(reference);
  value.setHours(hours, minutes, 0, 0);
  return value.toISOString();
}

function createOrders(reference: Date): DashboardOrder[] {
  return [
    {
      id: "order-2148",
      orderNumber: "SH-2148",
      customerName: "Mirembe",
      items: [{ id: "item-1", name: "Brisket tray", quantity: 2 }],
      status: "paid",
      total: 128000,
      createdAt: buildTodayTimestamp(reference, 10, 35),
      pickupTimeLabel: "Handoff 1:05 PM",
      stageLabel: "Waiting for Pit 2",
      promisedHandoffAt: buildTodayTimestamp(reference, 13, 5),
      stationAssignment: "Pit 2",
      queuePosition: 1,
      alertFlags: ["delayed"],
      holdReason: "Current rib load is running 18m behind the flip window."
    },
    {
      id: "order-2149",
      orderNumber: "SH-2149",
      customerName: "Bite Kampala",
      items: [{ id: "item-2", name: "Turkey wings", quantity: 3 }],
      status: "smoking",
      total: 93000,
      createdAt: buildTodayTimestamp(reference, 9, 20),
      pickupTimeLabel: "Courier 1:20 PM",
      stageLabel: "Second smoke pass",
      promisedHandoffAt: buildTodayTimestamp(reference, 13, 20),
      smokingStartedAt: buildTodayTimestamp(reference, 10, 12),
      estimatedFinishAt: buildTodayTimestamp(reference, 12, 38),
      stationAssignment: "Pit 1",
      alertFlags: []
    },
    {
      id: "order-2150",
      orderNumber: "SH-2150",
      customerName: "Lukwago",
      items: [{ id: "item-3", name: "Pork ribs rack", quantity: 2 }],
      status: "smoking",
      total: 116000,
      createdAt: buildTodayTimestamp(reference, 8, 50),
      pickupTimeLabel: "Handoff 12:50 PM",
      stageLabel: "Glaze and set",
      promisedHandoffAt: buildTodayTimestamp(reference, 12, 50),
      smokingStartedAt: buildTodayTimestamp(reference, 9, 42),
      estimatedFinishAt: buildTodayTimestamp(reference, 12, 32),
      stationAssignment: "Pit 2",
      alertFlags: ["overdue"]
    },
    {
      id: "order-2151",
      orderNumber: "SH-2151",
      customerName: "Nanyonga",
      items: [{ id: "item-4", name: "Half chicken", quantity: 4 }],
      status: "ready",
      total: 104000,
      createdAt: buildTodayTimestamp(reference, 9, 55),
      pickupTimeLabel: "Handoff 12:35 PM",
      stageLabel: "Hot hold / pickup rack",
      promisedHandoffAt: buildTodayTimestamp(reference, 12, 35),
      readyAt: buildTodayTimestamp(reference, 12, 8),
      stationAssignment: "Pickup shelf A",
      alertFlags: ["overdue"]
    },
    {
      id: "order-2152",
      orderNumber: "SH-2152",
      customerName: "Cafe Javas Wandegeya",
      items: [{ id: "item-5", name: "Beef short ribs", quantity: 1 }],
      status: "paid",
      total: 67000,
      createdAt: buildTodayTimestamp(reference, 11, 5),
      pickupTimeLabel: "Courier 1:40 PM",
      stageLabel: "Rubbed / tray sealed",
      promisedHandoffAt: buildTodayTimestamp(reference, 13, 40),
      stationAssignment: "Prep rail",
      queuePosition: 2,
      alertFlags: ["blocked"],
      holdReason: "Blocked until beef glaze batch is ready from sauce station."
    },
    {
      id: "order-2153",
      orderNumber: "SH-2153",
      customerName: "Walk-in",
      items: [{ id: "item-6", name: "Smoked sausage links", quantity: 5 }],
      status: "ready",
      total: 55000,
      createdAt: buildTodayTimestamp(reference, 11, 12),
      pickupTimeLabel: "Handoff 12:55 PM",
      stageLabel: "Waiting on cashier callout",
      promisedHandoffAt: buildTodayTimestamp(reference, 12, 55),
      readyAt: buildTodayTimestamp(reference, 12, 18),
      stationAssignment: "Pickup shelf B",
      alertFlags: []
    },
    {
      id: "order-2154",
      orderNumber: "SH-2154",
      customerName: "Kafeero",
      items: [{ id: "item-7", name: "Brisket sandwich kits", quantity: 6 }],
      status: "pending",
      total: 84000,
      createdAt: buildTodayTimestamp(reference, 12, 6),
      pickupTimeLabel: "Requested 2:05 PM",
      stageLabel: "Awaiting payment",
      promisedHandoffAt: buildTodayTimestamp(reference, 14, 5),
      stationAssignment: "Front counter",
      alertFlags: []
    },
    {
      id: "order-2155",
      orderNumber: "SH-2155",
      customerName: "Makindye FC",
      items: [{ id: "item-8", name: "Chicken trays", quantity: 2 }],
      status: "smoking",
      total: 148000,
      createdAt: buildTodayTimestamp(reference, 10, 10),
      pickupTimeLabel: "Courier 1:55 PM",
      stageLabel: "Holding bark color",
      promisedHandoffAt: buildTodayTimestamp(reference, 13, 55),
      smokingStartedAt: buildTodayTimestamp(reference, 11, 2),
      estimatedFinishAt: buildTodayTimestamp(reference, 13, 6),
      stationAssignment: "Pit 3",
      alertFlags: []
    },
    {
      id: "order-2156",
      orderNumber: "SH-2156",
      customerName: "Ndugwa",
      items: [{ id: "item-9", name: "Pork belly bites", quantity: 3 }],
      status: "paid",
      total: 78000,
      createdAt: buildTodayTimestamp(reference, 11, 28),
      pickupTimeLabel: "Handoff 2:15 PM",
      stageLabel: "Portioned / waiting stock release",
      promisedHandoffAt: buildTodayTimestamp(reference, 14, 15),
      stationAssignment: "Cold rail",
      queuePosition: 3,
      alertFlags: ["low_stock"],
      holdReason: "Only 3.8 kg belly remains after current smoker loads."
    },
    {
      id: "order-2157",
      orderNumber: "SH-2157",
      customerName: "Mugerwa",
      items: [{ id: "item-10", name: "Beef ribs", quantity: 1 }],
      status: "delivered",
      total: 62000,
      createdAt: buildTodayTimestamp(reference, 8, 5),
      pickupTimeLabel: "Collected 11:48 AM",
      stageLabel: "Completed",
      promisedHandoffAt: buildTodayTimestamp(reference, 11, 45),
      readyAt: buildTodayTimestamp(reference, 11, 24),
      stationAssignment: "Pickup shelf A",
      alertFlags: []
    },
    {
      id: "order-2158",
      orderNumber: "SH-2158",
      customerName: "Achan",
      items: [{ id: "item-11", name: "Turkey wings", quantity: 2 }],
      status: "cancelled",
      total: 46000,
      createdAt: buildTodayTimestamp(reference, 7, 55),
      pickupTimeLabel: "Cancelled 9:20 AM",
      stageLabel: "Cancelled",
      promisedHandoffAt: buildTodayTimestamp(reference, 12, 10),
      stationAssignment: "Front counter",
      alertFlags: []
    }
  ];
}

function createInventoryAlerts(): InventoryAlert[] {
  return [
    {
      id: "inv-1",
      name: "Beef brisket",
      level: "critical",
      note: "Only enough trimmed brisket for one more tray after SH-2148.",
      actionLabel: "Approve 12 kg supplier top-up before 2:00 PM",
      remainingKg: 5.6,
      parKg: 18,
      station: "Cold room"
    },
    {
      id: "inv-2",
      name: "Pork belly",
      level: "low",
      note: "Projected to miss walk-in buffer if SH-2156 starts this cycle.",
      actionLabel: "Shift tomorrow's prep trim into today's reserve",
      remainingKg: 3.8,
      parKg: 9,
      station: "Cold room"
    },
    {
      id: "inv-3",
      name: "Charcoal hopper",
      level: "critical",
      note: "Pit 2 and Pit 3 will need a refill before the 1:30 PM load swap.",
      actionLabel: "Load 2 more sacks into fuel bay",
      remainingKg: 14,
      parKg: 40,
      station: "Fuel bay"
    }
  ];
}

function createServiceAlerts(): ServiceAlert[] {
  return [
    {
      id: "alert-1",
      title: "Pit 2 load is behind",
      detail: "SH-2150 is already past its finish target and SH-2148 is waiting on the same chamber.",
      level: "critical",
      owner: "Pitmaster",
      dueLabel: "Act now",
      orderNumber: "SH-2150"
    },
    {
      id: "alert-2",
      title: "Pickup rack is aging out",
      detail: "SH-2151 has been on hot hold for 27m and still has no runner assigned.",
      level: "warning",
      owner: "Expediter",
      dueLabel: "Next 5 min",
      orderNumber: "SH-2151"
    },
    {
      id: "alert-3",
      title: "Glaze batch missing",
      detail: "Sauce station is blocking SH-2152 until the beef glaze pot is ready.",
      level: "warning",
      owner: "Sauce station",
      dueLabel: "12:35 PM",
      orderNumber: "SH-2152"
    },
    {
      id: "alert-4",
      title: "Brisket stock below lunch par",
      detail: "Two more brisket orders would consume the remaining reserve before evening prep lands.",
      level: "critical",
      owner: "Inventory lead",
      dueLabel: "12:45 PM"
    }
  ];
}

function createInventoryPressure(): InventoryPressureItem[] {
  return [
    {
      id: "pressure-1",
      itemName: "Brisket",
      remainingKg: 5.6,
      parKg: 18,
      committedKg: 4.8,
      station: "Cold room",
      nextDeliveryLabel: "Supplier van 3:30 PM",
      level: "critical"
    },
    {
      id: "pressure-2",
      itemName: "Pork ribs",
      remainingKg: 8.4,
      parKg: 16,
      committedKg: 5.2,
      station: "Cold room",
      nextDeliveryLabel: "No delivery due today",
      level: "low"
    },
    {
      id: "pressure-3",
      itemName: "Turkey wings",
      remainingKg: 7.9,
      parKg: 14,
      committedKg: 3.1,
      station: "Cold room",
      nextDeliveryLabel: "Trim batch at 2:15 PM",
      level: "low"
    },
    {
      id: "pressure-4",
      itemName: "Chicken halves",
      remainingKg: 13.2,
      parKg: 18,
      committedKg: 6.5,
      station: "Prep rail",
      nextDeliveryLabel: "Butchery batch 1:10 PM",
      level: "low"
    }
  ];
}

function createPitStatuses(): PitStatus[] {
  return [
    {
      id: "pit-1",
      name: "Pit 1",
      temperatureLabel: "118C",
      loadLabel: "72% loaded",
      nextCheckLabel: "Rotate wings 12:26 PM",
      fuelLabel: "Fuel 58%",
      note: "Turkey wing load is tracking on time.",
      tone: "steady"
    },
    {
      id: "pit-2",
      name: "Pit 2",
      temperatureLabel: "121C",
      loadLabel: "94% loaded",
      nextCheckLabel: "Pull ribs now",
      fuelLabel: "Fuel 33%",
      note: "Backlogged chamber. Clear SH-2150 before loading SH-2148.",
      tone: "critical"
    },
    {
      id: "pit-3",
      name: "Pit 3",
      temperatureLabel: "115C",
      loadLabel: "61% loaded",
      nextCheckLabel: "Baste chicken 12:34 PM",
      fuelLabel: "Fuel 41%",
      note: "Healthy capacity for the next chicken cycle.",
      tone: "watch"
    }
  ];
}

export function createDashboardSeedData(reference = new Date()): DashboardSeedData {
  return {
    orders: createOrders(reference),
    inventoryAlerts: createInventoryAlerts(),
    serviceAlerts: createServiceAlerts(),
    inventoryPressure: createInventoryPressure(),
    pitStatuses: createPitStatuses(),
    generatedAt: reference.toISOString()
  };
}
