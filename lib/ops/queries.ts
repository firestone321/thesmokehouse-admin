import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import {
  DailyStockRow,
  DashboardIssueRecord,
  DashboardSnapshot,
  InventoryItemRecord,
  InventoryMovementRecord,
  MenuCategoryRecord,
  MenuComponentRecord,
  MenuItemRecord,
  PortionTypeOption,
  OrderDetailRecord,
  OrderItemRecord,
  OrderListItem,
  OrderStatus,
  OrderStatusEventRecord
} from "@/lib/ops/types";
import { toOperationsError } from "@/lib/ops/errors";
import { getUgandaDayRange, getUgandaServiceDate, isDailyStockLow } from "@/lib/ops/utils";

function ensureNoError(error: { message: string } | null, context: string) {
  const mappedError = toOperationsError(error, context);

  if (mappedError) {
    throw mappedError;
  }
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapOrderItems(items: any[] | null | undefined) {
  const normalized = Array.isArray(items) ? items : [];
  const itemCount = normalized.reduce((sum, item) => sum + normalizeNumber(item.quantity), 0);
  const itemSummary = normalized.map((item) => `${item.menu_item_name} x${item.quantity}`).join(", ");

  return {
    itemCount,
    itemSummary: itemSummary.length > 0 ? itemSummary : "No items"
  };
}

function mapOrderListItem(row: any): OrderListItem {
  const { itemCount, itemSummary } = mapOrderItems(row.order_items);

  return {
    id: normalizeNumber(row.id),
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    status: row.status as OrderStatus,
    totalAmount: normalizeNumber(row.total_amount),
    promisedAt: row.promised_at,
    createdAt: row.created_at,
    notes: row.notes,
    itemSummary,
    itemCount
  };
}

function mapDailyStockRow(row: any): DailyStockRow {
  const startingQuantity = normalizeNumber(row.starting_quantity);
  const remainingQuantity = normalizeNumber(row.remaining_quantity);

  return {
    stockDate: row.stock_date,
    portionTypeId: normalizeNumber(row.portion_type_id),
    portionCode: row.portion_code,
    portionName: row.portion_name,
    portionLabel: row.portion_label,
    proteinName: row.protein_name,
    packagingTypeName: row.packaging_type_name,
    startingQuantity,
    reservedQuantity: normalizeNumber(row.reserved_quantity),
    soldQuantity: normalizeNumber(row.sold_quantity),
    wasteQuantity: normalizeNumber(row.waste_quantity),
    remainingQuantity,
    isInitialized: Boolean(row.is_initialized),
    isLowStock: isDailyStockLow(startingQuantity, remainingQuantity)
  };
}

function getNeedsActionPriority(order: OrderListItem) {
  if (order.status === "ready") return 0;
  if (order.promisedAt && new Date(order.promisedAt).getTime() < Date.now()) return 1;
  if (order.status === "new") return 2;
  if (order.status === "confirmed") return 3;
  return 4;
}

function getOverdueOrderIssues(orders: OrderListItem[]): DashboardIssueRecord[] {
  return orders
    .filter((order) => {
      if (!order.promisedAt) return false;
      if (order.status === "completed" || order.status === "cancelled") return false;
      return new Date(order.promisedAt).getTime() < Date.now();
    })
    .slice(0, 3)
    .map((order) => ({
      id: `order-${order.id}`,
      title: `${order.orderNumber} is outside its promised window`,
      detail: order.itemSummary,
      severity: order.status === "ready" ? "critical" : "warning",
      owner: "Orders"
    }));
}

export function getAllowedNextStatuses(status: OrderStatus) {
  switch (status) {
    case "new":
      return ["confirmed", "cancelled"] as const;
    case "confirmed":
      return ["in_prep", "cancelled"] as const;
    case "in_prep":
      return ["on_smoker", "cancelled"] as const;
    case "on_smoker":
      return ["ready", "cancelled"] as const;
    case "ready":
      return ["completed", "cancelled"] as const;
    default:
      return [] as const;
  }
}

export async function getOrdersPageData(options?: {
  status?: string | null;
  search?: string | null;
}) {
  noStore();

  const supabase = createAdminSupabaseClient();
  const status = options?.status?.trim() || "all";
  const search = options?.search?.trim() || "";

  let query = supabase
    .from("orders")
    .select(
      `
      id,
      order_number,
      customer_name,
      customer_phone,
      status,
      total_amount,
      promised_at,
      created_at,
      notes,
      order_items (
        quantity,
        menu_item_name
      )
    `
    )
    .order("created_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (search.length > 0) {
    const sanitized = search.replace(/,/g, " ");
    query = query.or(`order_number.ilike.%${sanitized}%,customer_name.ilike.%${sanitized}%,customer_phone.ilike.%${sanitized}%`);
  }

  const { data, error } = await query;
  ensureNoError(error, "Unable to load orders");

  return {
    status,
    search,
    orders: (data ?? []).map(mapOrderListItem)
  };
}

export async function getOrderDetail(orderId: number | string): Promise<OrderDetailRecord | null> {
  noStore();

  const supabase = createAdminSupabaseClient();
  const normalizedId = normalizeNumber(orderId);

  const [orderResponse, eventsResponse] = await Promise.all([
    supabase
      .from("orders")
      .select(
        `
        id,
        order_number,
        customer_name,
        customer_phone,
        status,
        total_amount,
        promised_at,
        created_at,
        notes,
        order_items (
          id,
          menu_item_id,
          menu_item_name,
          quantity,
          unit_price,
          line_total
        )
      `
      )
      .eq("id", normalizedId)
      .maybeSingle(),
    supabase
      .from("order_status_events")
      .select("id, event_type, from_status, to_status, note, created_at")
      .eq("order_id", normalizedId)
      .order("created_at", { ascending: false })
  ]);

  ensureNoError(orderResponse.error, "Unable to load order detail");
  ensureNoError(eventsResponse.error, "Unable to load order events");

  if (!orderResponse.data) {
    return null;
  }

  const items: OrderItemRecord[] = (orderResponse.data.order_items ?? []).map((item: any) => ({
    id: normalizeNumber(item.id),
    menuItemId: normalizeNumber(item.menu_item_id),
    menuItemName: item.menu_item_name,
    quantity: normalizeNumber(item.quantity),
    unitPrice: normalizeNumber(item.unit_price),
    lineTotal: normalizeNumber(item.line_total)
  }));

  const events: OrderStatusEventRecord[] = (eventsResponse.data ?? []).map((event: any) => ({
    id: normalizeNumber(event.id),
    eventType: event.event_type,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    note: event.note,
    createdAt: event.created_at
  }));

  return {
    id: normalizeNumber(orderResponse.data.id),
    orderNumber: orderResponse.data.order_number,
    customerName: orderResponse.data.customer_name,
    customerPhone: orderResponse.data.customer_phone,
    status: orderResponse.data.status as OrderStatus,
    totalAmount: normalizeNumber(orderResponse.data.total_amount),
    promisedAt: orderResponse.data.promised_at,
    createdAt: orderResponse.data.created_at,
    notes: orderResponse.data.notes,
    items,
    events
  };
}

export async function getInventoryPageData(selectedItemId?: string | null) {
  noStore();

  const supabase = createAdminSupabaseClient();
  const serviceDate = getUgandaServiceDate();

  const [dailyStockResponse, itemsResponse] = await Promise.all([
    supabase.rpc("get_daily_menu_stock", { p_stock_date: serviceDate }),
    supabase
      .from("inventory_items")
      .select("id, code, name, unit_name, current_quantity, reorder_threshold, is_active, updated_at")
      .order("name", { ascending: true })
  ]);

  ensureNoError(dailyStockResponse.error, "Unable to load daily stock");
  ensureNoError(itemsResponse.error, "Unable to load inventory items");

  const dailyStock = (dailyStockResponse.data ?? []).map(mapDailyStockRow);
  const inventoryItems: InventoryItemRecord[] = (itemsResponse.data ?? []).map((item: any) => {
    const currentQuantity = normalizeNumber(item.current_quantity);
    const reorderThreshold = normalizeNumber(item.reorder_threshold);

    return {
      id: normalizeNumber(item.id),
      code: item.code,
      name: item.name,
      unitName: item.unit_name,
      currentQuantity,
      reorderThreshold,
      isActive: Boolean(item.is_active),
      updatedAt: item.updated_at,
      isLowStock: currentQuantity <= reorderThreshold
    };
  });

  const normalizedSelectedId = selectedItemId ? normalizeNumber(selectedItemId) : inventoryItems[0]?.id ?? null;
  const selectedItem = inventoryItems.find((item) => item.id === normalizedSelectedId) ?? null;

  let movementHistory: InventoryMovementRecord[] = [];

  if (selectedItem) {
    const { data, error } = await supabase
      .from("inventory_movements")
      .select("id, inventory_item_id, movement_type, quantity_delta, resulting_quantity, note, created_at")
      .eq("inventory_item_id", selectedItem.id)
      .order("created_at", { ascending: false })
      .limit(20);

    ensureNoError(error, "Unable to load inventory movements");

    movementHistory = (data ?? []).map((movement: any) => ({
      id: normalizeNumber(movement.id),
      inventoryItemId: normalizeNumber(movement.inventory_item_id),
      movementType: movement.movement_type,
      quantityDelta: normalizeNumber(movement.quantity_delta),
      resultingQuantity: normalizeNumber(movement.resulting_quantity),
      note: movement.note,
      createdAt: movement.created_at
    }));
  }

  return {
    serviceDate,
    dailyStock,
    inventoryItems,
    selectedItem,
    movementHistory
  };
}

export async function getMenuPageData(editMenuItemId?: string | null) {
  noStore();

  const supabase = createAdminSupabaseClient();

  const [categoriesResponse, portionTypesResponse, inventoryItemsResponse, menuItemsResponse] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, code, name, sort_order, is_active")
      .order("sort_order", { ascending: true }),
    supabase
      .from("portion_types")
      .select("id, code, name, portion_label, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("inventory_items")
      .select("id, code, name, unit_name, current_quantity, reorder_threshold, is_active, updated_at")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("menu_items")
      .select(
        `
        id,
        code,
        name,
        description,
        image_url,
        base_price,
        prep_type,
        is_active,
        is_available_today,
        sort_order,
        menu_category_id,
        portion_type_id,
        menu_categories (
          id,
          name
        ),
        portion_types (
          id,
          name,
          portion_label
        ),
        menu_item_components (
          id,
          quantity_required,
          inventory_items (
            id,
            name,
            unit_name
          )
        )
      `
      )
      .order("sort_order", { ascending: true })
  ]);

  ensureNoError(categoriesResponse.error, "Unable to load menu categories");
  ensureNoError(portionTypesResponse.error, "Unable to load portion types");
  ensureNoError(inventoryItemsResponse.error, "Unable to load inventory items for menu");
  ensureNoError(menuItemsResponse.error, "Unable to load menu items");

  const categories: MenuCategoryRecord[] = (categoriesResponse.data ?? []).map((category: any) => ({
    id: normalizeNumber(category.id),
    code: category.code,
    name: category.name,
    sortOrder: normalizeNumber(category.sort_order),
    isActive: Boolean(category.is_active)
  }));

  const inventoryItems: InventoryItemRecord[] = (inventoryItemsResponse.data ?? []).map((item: any) => {
    const currentQuantity = normalizeNumber(item.current_quantity);
    const reorderThreshold = normalizeNumber(item.reorder_threshold);

    return {
      id: normalizeNumber(item.id),
      code: item.code,
      name: item.name,
      unitName: item.unit_name,
      currentQuantity,
      reorderThreshold,
      isActive: Boolean(item.is_active),
      updatedAt: item.updated_at,
      isLowStock: currentQuantity <= reorderThreshold
    };
  });

  const menuItems: MenuItemRecord[] = (menuItemsResponse.data ?? []).map((item: any) => {
    const components: MenuComponentRecord[] = (item.menu_item_components ?? []).map((component: any) => ({
      id: normalizeNumber(component.id),
      inventoryItemId: normalizeNumber(component.inventory_items?.id),
      inventoryItemName: component.inventory_items?.name ?? "Unknown",
      unitName: component.inventory_items?.unit_name ?? "",
      quantityRequired: normalizeNumber(component.quantity_required)
    }));

    return {
      id: normalizeNumber(item.id),
      code: item.code,
      name: item.name,
      description: item.description,
      imageUrl: item.image_url,
      basePrice: normalizeNumber(item.base_price),
      prepType: item.prep_type,
      isActive: Boolean(item.is_active),
      isAvailableToday: Boolean(item.is_available_today),
      sortOrder: normalizeNumber(item.sort_order),
      categoryId: normalizeNumber(item.menu_category_id),
      categoryName: item.menu_categories?.name ?? "Uncategorized",
      portionTypeId: normalizeNumber(item.portion_type_id),
      portionLabel: `${item.portion_types?.name ?? "Portion"}${item.portion_types?.portion_label ? ` (${item.portion_types.portion_label})` : ""}`,
      components
    };
  });

  const selectedMenuItemId = editMenuItemId ? normalizeNumber(editMenuItemId) : null;
  const selectedMenuItem = menuItems.find((item) => item.id === selectedMenuItemId) ?? null;
  const assignedPortionTypeIds = new Set(menuItems.map((item) => item.portionTypeId));
  const portionTypes: PortionTypeOption[] = (portionTypesResponse.data ?? []).map((portion: any) => {
    const portionTypeId = normalizeNumber(portion.id);

    return {
      id: portionTypeId,
      code: portion.code,
      label: `${portion.name}${portion.portion_label ? ` (${portion.portion_label})` : ""}`,
      isAssigned: assignedPortionTypeIds.has(portionTypeId) && selectedMenuItem?.portionTypeId !== portionTypeId
    };
  });

  return {
    categories,
    portionTypes,
    inventoryItems,
    menuItems,
    selectedMenuItem
  };
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  noStore();

  const supabase = createAdminSupabaseClient();
  const { serviceDate, startIso, endIso } = getUgandaDayRange();

  const [activeOrdersResponse, todaysOrdersResponse, dailyStockResponse, incidentsResponse] = await Promise.all([
    supabase
      .from("orders")
      .select(
        `
        id,
        order_number,
        customer_name,
        customer_phone,
        status,
        total_amount,
        promised_at,
        created_at,
        notes,
        order_items (
          quantity,
          menu_item_name
        )
      `
      )
      .in("status", ["new", "confirmed", "in_prep", "on_smoker", "ready"])
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select(
        `
        id,
        order_number,
        customer_name,
        customer_phone,
        status,
        total_amount,
        promised_at,
        created_at,
        notes,
        order_items (
          quantity,
          menu_item_name
        )
      `
      )
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false }),
    supabase.rpc("get_daily_menu_stock", { p_stock_date: serviceDate }),
    supabase
      .from("ops_incidents")
      .select("id, title, detail, severity, owner, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(5)
  ]);

  ensureNoError(activeOrdersResponse.error, "Unable to load dashboard active orders");
  ensureNoError(todaysOrdersResponse.error, "Unable to load dashboard today orders");
  ensureNoError(dailyStockResponse.error, "Unable to load dashboard daily stock");
  ensureNoError(incidentsResponse.error, "Unable to load dashboard incidents");

  const activeOrders = (activeOrdersResponse.data ?? []).map(mapOrderListItem);
  const todaysOrders = (todaysOrdersResponse.data ?? []).map(mapOrderListItem);
  const dailyStock = (dailyStockResponse.data ?? []).map(mapDailyStockRow);
  const lowStockItems = dailyStock.filter((item: DailyStockRow) => item.isInitialized && item.isLowStock).slice(0, 5);

  const revenueToday = todaysOrders
    .filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + order.totalAmount, 0);

  const smokerOrders = activeOrders.filter((order) => order.status === "on_smoker");
  const readyOrders = activeOrders.filter((order) => order.status === "ready");
  const actionOrders = [...activeOrders]
    .sort((left, right) => getNeedsActionPriority(left) - getNeedsActionPriority(right))
    .slice(0, 5);

  const incidents: DashboardIssueRecord[] = (incidentsResponse.data ?? []).map((incident: any) => ({
    id: `incident-${incident.id}`,
    title: incident.title,
    detail: incident.detail ?? "Operational issue opened",
    severity: incident.severity,
    owner: incident.owner ?? "Operations",
    createdAt: incident.created_at
  }));

  const issues = [...incidents, ...getOverdueOrderIssues(activeOrders)].slice(0, 6);

  return {
    serviceDate,
    generatedAt: new Date().toISOString(),
    metrics: {
      needsActionNow: actionOrders.length,
      onSmoker: smokerOrders.length,
      readyForPickup: readyOrders.length,
      lowStockPressure: lowStockItems.length,
      revenueToday,
      issuesNeedingAttention: issues.length
    },
    actionOrders,
    smokerOrders,
    readyOrders,
    lowStockItems,
    issues
  };
}
