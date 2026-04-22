import "server-only";
import { unstable_noStore as noStore } from "next/cache";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { isLocalAuthBypassEnabled } from "@/lib/auth/local-bypass";
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
  FinishedStockRecord,
  ProcessingBatchRecord,
  ProcurementActivityRecord,
  ProcurementInventoryOption,
  ProcurementPageData,
  ProcurementPortionOption,
  ProcurementSupplierOption,
  InventoryPageData,
  SupplierPageData,
  SupplierRecord,
  SupplierSupplyHistoryRecord,
  OrderDetailRecord,
  OrderItemRecord,
  OrderListItem,
  OrderStatus,
  OrderStatusEventRecord
} from "@/lib/ops/types";
import { toOperationsError } from "@/lib/ops/errors";
import { getUgandaDayRange, getUgandaServiceDate, isDailyStockLow } from "@/lib/ops/utils";

const procurementMigrationFiles = [
  "db/phase-01-reference-tables.sql",
  "db/phase-02-daily-stock.sql",
  "db/phase-03-operations-core.sql",
  "db/phase-09-menu-item-images.sql",
  "db/phase-10-procurement.sql",
  "db/phase-11-finished-stock.sql",
  "db/phase-12-split-red-meat-cuts.sql",
  "db/phase-13-supplier-traceability-and-sides.sql",
  "db/phase-14-processing-yield-weight.sql",
  "db/phase-15-goat-300g.sql",
  "db/phase-16-chicken-processing-allocation.sql",
  "db/phase-17-ingredient-intake.sql",
  "db/phase-18-supplier-intake-segmentation.sql",
  "db/phase-20-fries-direct-sellable.sql",
  "db/phase-21-pesapal-paid-reservations.sql"
];

function ensureNoError(
  error:
    | {
        message?: string | null;
        details?: string | null;
        hint?: string | null;
        code?: string | null;
        cause?: unknown;
      }
    | null,
  context: string,
  migrationFiles?: string[]
) {
  const mappedError = toOperationsError(error, context, migrationFiles);

  if (mappedError) {
    throw mappedError;
  }
}

type SupabaseResponse<T> = {
  data: T | null;
  error: {
    message?: string | null;
    details?: string | null;
    hint?: string | null;
    code?: string | null;
    cause?: unknown;
  } | null;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createOperationsReadClient() {
  if (await isLocalAuthBypassEnabled()) {
    return createAdminSupabaseClient();
  }

  return createServerSupabaseClient();
}

function formatRpcError(error: SupabaseResponse<unknown>["error"]) {
  if (!error) {
    return "unknown error";
  }

  const parts = [error.message, error.details, error.hint, error.code ? `code=${error.code}` : null]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  if (parts.length > 0) {
    return parts.join(" | ");
  }

  if (error.cause instanceof Error && error.cause.message.trim().length > 0) {
    return error.cause.message;
  }

  return "unknown error";
}

function isTransientDailyStockRpcError(error: SupabaseResponse<unknown>["error"]) {
  if (!error) {
    return false;
  }

  const normalized = formatRpcError(error).toLowerCase();

  return [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "socket",
    "econnreset",
    "econnrefused",
    "enotfound",
    "eai_again",
    "tls",
    "terminated",
    "aborted"
  ].some((fragment) => normalized.includes(fragment));
}

async function loadDailyMenuStock(serviceDate: string, options?: { allowTransientFallback?: boolean }) {
  const maxAttempts = 2;
  let lastResponse: SupabaseResponse<any[]> | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await createAdminSupabaseClient().rpc("get_daily_menu_stock", { p_stock_date: serviceDate });
    lastResponse = response;

    if (!response.error) {
      if (attempt > 1) {
        console.info(
          `[ops] get_daily_menu_stock recovered after retry for ${serviceDate} on attempt ${attempt}/${maxAttempts}`
        );
      }

      return response;
    }

    const transient = isTransientDailyStockRpcError(response.error);

    console.warn(
      `[ops] get_daily_menu_stock failed for ${serviceDate} on attempt ${attempt}/${maxAttempts}: ${formatRpcError(response.error)}`
    );

    if (!transient || attempt === maxAttempts) {
      break;
    }

    await delay(250);
  }

  if (options?.allowTransientFallback && lastResponse?.error && isTransientDailyStockRpcError(lastResponse.error)) {
    console.error(
      `[ops] Falling back to empty daily stock for ${serviceDate} after repeated transient get_daily_menu_stock failures`
    );

    return {
      data: [],
      error: null
    };
  }

  return lastResponse ?? {
    data: null,
    error: {
      message: "Daily stock request did not return a response"
    }
  };
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUnitName(unitName: string | null | undefined) {
  return String(unitName ?? "")
    .trim()
    .toLowerCase();
}

function parsePortionWeightKg(portionLabel: string | null | undefined) {
  const match = String(portionLabel ?? "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*g$/i);

  if (!match) {
    return null;
  }

  const grams = Number.parseFloat(match[1]);
  return Number.isFinite(grams) && grams > 0 ? grams / 1000 : null;
}

function convertQuantityToKg(quantity: number, unitName: string | null | undefined) {
  const normalizedUnit = normalizeUnitName(unitName);

  if (normalizedUnit === "kg" || normalizedUnit === "kilogram" || normalizedUnit === "kilograms") {
    return quantity;
  }

  if (normalizedUnit === "g" || normalizedUnit === "gram" || normalizedUnit === "grams") {
    return quantity / 1000;
  }

  return null;
}

function convertKgToReceiptUnit(quantityKg: number, unitName: string | null | undefined) {
  const normalizedUnit = normalizeUnitName(unitName);

  if (normalizedUnit === "kg" || normalizedUnit === "kilogram" || normalizedUnit === "kilograms") {
    return quantityKg;
  }

  if (normalizedUnit === "g" || normalizedUnit === "gram" || normalizedUnit === "grams") {
    return quantityKg * 1000;
  }

  return null;
}

function isWithinLastHour(isoTimestamp: string | null | undefined) {
  if (!isoTimestamp) {
    return false;
  }

  const timestamp = new Date(isoTimestamp).getTime();

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return Date.now() - timestamp <= 60 * 60 * 1000;
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
    paymentStatus: (row.payment_status ?? "pending") as any,
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

function mapProcurementActivity(
  row: any,
  options?: {
    processedHalves?: number;
    processedQuarters?: number;
    processedWeightKg?: number | null;
    remainingQuantity?: number | null;
    hasProcessingBatch?: boolean;
    latestProcessingAt?: string | null;
  }
): ProcurementActivityRecord {
  const quantityReceived = normalizeNumber(row.quantity_received);
  const allocatedToHalves = normalizeNumber(row.allocated_to_halves);
  const allocatedToQuarters = normalizeNumber(row.allocated_to_quarters);
  const isWholeChicken = row.protein_code === "whole_chicken";

  return {
    id: normalizeNumber(row.id),
    intakeType: row.intake_type,
    proteinCode: row.protein_code,
    inventoryItemId: row.inventory_item_id ? normalizeNumber(row.inventory_item_id) : null,
    supplierId: row.supplier_id ? normalizeNumber(row.supplier_id) : null,
    itemName: row.item_name,
    supplierName: row.supplier_name,
    batchNumber: row.batch_number,
    deliveryDate: row.delivery_date,
    butcheredOn: row.butchered_on,
    abattoirName: row.abattoir_name,
    vetStampNumber: row.vet_stamp_number,
    inspectionOfficerName: row.inspection_officer_name,
    quantityReceived,
    unitName: row.unit_name,
    unitCost: row.unit_cost === null ? null : normalizeNumber(row.unit_cost),
    note: row.note,
    allocatedToHalves,
    allocatedToQuarters,
    theoreticalHalfYield: isWholeChicken ? quantityReceived * 2 : 0,
    theoreticalQuarterYield: isWholeChicken ? quantityReceived * 4 : 0,
    sellableHalves: allocatedToHalves * 2,
    sellableQuarters: allocatedToQuarters * 4,
    processedHalves: normalizeNumber(options?.processedHalves),
    processedQuarters: normalizeNumber(options?.processedQuarters),
    processedWeightKg:
      options?.processedWeightKg === null || options?.processedWeightKg === undefined
        ? null
        : normalizeNumber(options.processedWeightKg),
    remainingQuantity:
      options?.remainingQuantity === null || options?.remainingQuantity === undefined
        ? null
        : normalizeNumber(options.remainingQuantity),
    hasProcessingBatch: Boolean(options?.hasProcessingBatch),
    latestProcessingAt: options?.latestProcessingAt ?? null,
    createdAt: row.created_at
  };
}

function mapFinishedStock(row: any): FinishedStockRecord {
  const portionName = row.portion_types?.name ?? "Portion";
  const portionLabel = row.portion_types?.portion_label ? `${portionName} (${row.portion_types.portion_label})` : portionName;

  return {
    portionTypeId: normalizeNumber(row.portion_type_id),
    portionCode: row.portion_types?.code ?? "",
    portionLabel,
    proteinCode: row.portion_types?.proteins?.code ?? null,
    currentQuantity: normalizeNumber(row.current_quantity),
    updatedAt: row.updated_at
  };
}

function mapProcessingBatch(row: any): ProcessingBatchRecord {
  return {
    id: normalizeNumber(row.id),
    procurementReceiptId: normalizeNumber(row.procurement_receipt_id),
    receiptItemName: row.procurement_receipts?.item_name ?? "Receipt",
    receiptBatchNumber: row.procurement_receipts?.batch_number ?? null,
    receiptSupplierName: row.procurement_receipts?.supplier_name ?? "Unknown supplier",
    rawWeightKg: row.procurement_receipts?.quantity_received === null ? null : normalizeNumber(row.procurement_receipts?.quantity_received),
    portionTypeId: normalizeNumber(row.portion_type_id),
    portionCode: row.portion_types?.code ?? "",
    portionName: row.portion_types?.portion_label
      ? `${row.portion_types.name} (${row.portion_types.portion_label})`
      : row.portion_types?.name ?? "Portion",
    quantityProduced: normalizeNumber(row.quantity_produced),
    postRoastPackedWeightKg:
      row.post_roast_packed_weight_kg === null ? null : normalizeNumber(row.post_roast_packed_weight_kg),
    yieldPercent: row.yield_percent === null ? null : normalizeNumber(row.yield_percent),
    note: row.note,
    createdAt: row.created_at
  };
}

function mapSupplier(row: any): SupplierRecord {
  return {
    id: normalizeNumber(row.id),
    name: row.name,
    phoneNumber: row.phone_number,
    licenseNumber: row.license_number,
    supplierType: row.supplier_type,
    defaultAbattoirName: row.default_abattoir_name,
    isActive: Boolean(row.is_active),
    notes: row.notes,
    updatedAt: row.updated_at
  };
}

function mapSupplierSupplyHistory(row: any): SupplierSupplyHistoryRecord {
  return {
    id: normalizeNumber(row.id),
    supplierId: row.supplier_id ? normalizeNumber(row.supplier_id) : null,
    supplierName: row.supplier_name ?? "Unknown supplier",
    batchNumber: row.batch_number,
    intakeType: row.intake_type,
    proteinCode: row.protein_code,
    itemName: row.item_name,
    quantityReceived: normalizeNumber(row.quantity_received),
    unitName: row.unit_name,
    deliveryDate: row.delivery_date,
    butcheredOn: row.butchered_on,
    abattoirName: row.abattoir_name,
    vetStampNumber: row.vet_stamp_number,
    inspectionOfficerName: row.inspection_officer_name,
    note: row.note,
    createdAt: row.created_at
  };
}

function getNeedsActionPriority(order: OrderListItem) {
  if (order.status === "ready") return 0;
  if (order.promisedAt && new Date(order.promisedAt).getTime() < Date.now()) return 1;
  if (order.status === "confirmed") return 2;
  if (order.status === "in_prep") return 3;
  return 4;
}

function getOverdueOrderIssues(orders: OrderListItem[]): DashboardIssueRecord[] {
  return orders
    .filter((order) => {
      if (!order.promisedAt) return false;
      if (order.status === "completed" || order.status === "cancelled") return false;
      if (order.paymentStatus !== "paid") return false;
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
      return [] as const;
    case "confirmed":
      return ["in_prep"] as const;
    case "in_prep":
      return ["ready"] as const;
    case "ready":
      return ["completed"] as const;
    default:
      return [] as const;
  }
}

export async function getOrdersPageData(options?: {
  status?: string | null;
  search?: string | null;
}) {
  noStore();

  const supabase = await createOperationsReadClient();
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
      payment_status,
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

  const supabase = await createOperationsReadClient();
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
        payment_status,
        pickup_code,
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
    paymentStatus: (orderResponse.data.payment_status ?? "pending") as any,
    pickupCode: orderResponse.data.pickup_code ?? null,
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
  const { startIso, endIso } = getUgandaDayRange();

  const [dailyStockResponse, itemsResponse, suppliersResponse, finishedStockResponse, processingBatchesResponse] = await Promise.all([
    loadDailyMenuStock(serviceDate, { allowTransientFallback: true }),
    supabase
      .from("inventory_items")
      .select("id, code, name, unit_name, item_type, current_quantity, reorder_threshold, is_active, updated_at")
      .order("name", { ascending: true }),
    supabase
      .from("suppliers")
      .select("id, name, phone_number, license_number, supplier_type, default_abattoir_name")
      .eq("is_active", true)
      .in("supplier_type", ["supply", "mixed"])
      .order("name", { ascending: true }),
    supabase
      .from("finished_stock")
      .select(
        `
        portion_type_id,
        current_quantity,
        updated_at,
        portion_types (
          code,
          name,
          portion_label,
          proteins (
            code
          )
        )
      `
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("processing_batches")
      .select(
        `
        id,
        procurement_receipt_id,
        portion_type_id,
        quantity_produced,
        post_roast_packed_weight_kg,
        yield_percent,
        note,
        created_at,
        portion_types (
          code,
          name,
          portion_label
        ),
        procurement_receipts (
          item_name,
          batch_number,
          supplier_name,
          quantity_received
        )
      `
      )
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false })
  ]);

  ensureNoError(dailyStockResponse.error, "Unable to load daily stock");
  ensureNoError(itemsResponse.error, "Unable to load inventory items");
  ensureNoError(suppliersResponse.error, "Unable to load supply suppliers", procurementMigrationFiles);
  ensureNoError(finishedStockResponse.error, "Unable to load finished frozen stock", procurementMigrationFiles);
  ensureNoError(processingBatchesResponse.error, "Unable to load today's processing batches", procurementMigrationFiles);

  const dailyStock = (dailyStockResponse.data ?? []).map(mapDailyStockRow);
  const inventoryItems: InventoryItemRecord[] = (itemsResponse.data ?? []).map((item: any) => {
    const currentQuantity = normalizeNumber(item.current_quantity);
    const reorderThreshold = normalizeNumber(item.reorder_threshold);

    return {
      id: normalizeNumber(item.id),
      code: item.code,
      name: item.name,
      unitName: item.unit_name,
      itemType: item.item_type ?? "supply",
      currentQuantity,
      reorderThreshold,
      isActive: Boolean(item.is_active),
      updatedAt: item.updated_at,
      isLowStock: currentQuantity <= reorderThreshold
    };
  });
  const suppliers = (suppliersResponse.data ?? []).map((supplier: any) => ({
    id: normalizeNumber(supplier.id),
    name: supplier.name,
    phoneNumber: supplier.phone_number,
    licenseNumber: supplier.license_number,
    supplierType: supplier.supplier_type,
    defaultAbattoirName: supplier.default_abattoir_name
  }));
  const finishedStock = (finishedStockResponse.data ?? []).map(mapFinishedStock);
  const todayProcessingBatches = (processingBatchesResponse.data ?? []).map(mapProcessingBatch);

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

  const result: InventoryPageData = {
    serviceDate,
    dailyStock,
    inventoryItems,
    suppliers,
    selectedItem,
    movementHistory,
    finishedStock,
    todayProcessingBatches
  };

  return result;
}

export async function getProcurementPageData(): Promise<ProcurementPageData> {
  noStore();

  const supabase = createAdminSupabaseClient();
  const serviceDate = getUgandaServiceDate();

  const [
    inventoryItemsResponse,
    suppliersResponse,
    portionOptionsResponse,
    finishedStockResponse,
    recentActivityResponse,
    processingReceiptsResponse,
    recentProcessingBatchesResponse
  ] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, code, name, unit_name, item_type, current_quantity, reorder_threshold")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("suppliers")
      .select("id, name, phone_number, license_number, supplier_type, default_abattoir_name")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("portion_types")
      .select(
        `
        id,
        code,
        name,
        portion_label,
        proteins (
          code
        )
      `
      )
      .eq("is_active", true)
      .not("protein_id", "is", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("finished_stock")
      .select(
        `
        portion_type_id,
        current_quantity,
        updated_at,
        portion_types (
          code,
          name,
          portion_label,
          proteins (
            code
          )
        )
      `
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("procurement_receipts")
      .select(
        "id, intake_type, protein_code, inventory_item_id, supplier_id, item_name, supplier_name, batch_number, delivery_date, butchered_on, abattoir_name, vet_stamp_number, inspection_officer_name, quantity_received, unit_name, unit_cost, note, allocated_to_halves, allocated_to_quarters, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("procurement_receipts")
      .select(
        "id, intake_type, protein_code, inventory_item_id, supplier_id, item_name, supplier_name, batch_number, delivery_date, butchered_on, abattoir_name, vet_stamp_number, inspection_officer_name, quantity_received, unit_name, unit_cost, note, allocated_to_halves, allocated_to_quarters, created_at"
      )
      .eq("intake_type", "protein")
      .order("delivery_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("processing_batches")
      .select(
        `
        id,
        procurement_receipt_id,
        portion_type_id,
        quantity_produced,
        post_roast_packed_weight_kg,
        yield_percent,
        note,
        created_at,
        portion_types (
          code,
          name,
          portion_label
        ),
        procurement_receipts (
          item_name,
          batch_number,
          supplier_name,
          quantity_received
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(20)
  ]);

  ensureNoError(inventoryItemsResponse.error, "Unable to load tracked supply items");
  ensureNoError(suppliersResponse.error, "Unable to load suppliers", procurementMigrationFiles);
  ensureNoError(portionOptionsResponse.error, "Unable to load sellable portion options");
  ensureNoError(finishedStockResponse.error, "Unable to load finished frozen stock", procurementMigrationFiles);
  ensureNoError(recentActivityResponse.error, "Unable to load procurement activity", procurementMigrationFiles);
  ensureNoError(processingReceiptsResponse.error, "Unable to load processing protein receipts", procurementMigrationFiles);
  ensureNoError(recentProcessingBatchesResponse.error, "Unable to load processing batch history", procurementMigrationFiles);

  const recentActivityRows = recentActivityResponse.data ?? [];
  const processingReceiptRows = processingReceiptsResponse.data ?? [];
  const proteinReceiptIds = [...recentActivityRows, ...processingReceiptRows]
    .map((row: any) => normalizeNumber(row.id))
    .filter((id) => id > 0);

  const processingProgressResponse =
    proteinReceiptIds.length > 0
      ? await supabase
        .from("processing_batches")
        .select(
          `
          procurement_receipt_id,
          quantity_produced,
          post_roast_packed_weight_kg,
          created_at,
          portion_types (
            code,
            portion_label
          )
        `
        )
        .in("procurement_receipt_id", proteinReceiptIds)
      : { data: [], error: null };

  ensureNoError(
    processingProgressResponse.error,
    "Unable to load processing receipt progress",
    procurementMigrationFiles
  );

  const inventoryItems: ProcurementInventoryOption[] = (inventoryItemsResponse.data ?? []).map((item: any) => ({
    id: normalizeNumber(item.id),
    code: item.code,
    name: item.name,
    unitName: item.unit_name,
    itemType: item.item_type ?? "supply",
    currentQuantity: normalizeNumber(item.current_quantity),
    reorderThreshold: normalizeNumber(item.reorder_threshold)
  }));

  const suppliers: ProcurementSupplierOption[] = (suppliersResponse.data ?? []).map((supplier: any) => ({
    id: normalizeNumber(supplier.id),
    name: supplier.name,
    phoneNumber: supplier.phone_number,
    licenseNumber: supplier.license_number,
    supplierType: supplier.supplier_type,
    defaultAbattoirName: supplier.default_abattoir_name
  }));

  const portionOptions: ProcurementPortionOption[] = (portionOptionsResponse.data ?? []).map((portion: any) => ({
    id: normalizeNumber(portion.id),
    code: portion.code,
    name: portion.name,
    portionLabel: portion.portion_label,
    proteinCode: portion.proteins?.code ?? null
  }));

  const finishedStock = (finishedStockResponse.data ?? []).map(mapFinishedStock);
  const recentProcessingBatches = (recentProcessingBatchesResponse.data ?? []).map(mapProcessingBatch);
  const processedByReceipt = new Map<number, { halves: number; quarters: number }>();
  const weightProcessedByReceipt = new Map<number, number>();
  const latestProcessingAtByReceipt = new Map<number, string>();

  (processingProgressResponse.data ?? []).forEach((row: any) => {
    const receiptId = normalizeNumber(row.procurement_receipt_id);

    if (receiptId <= 0) {
      return;
    }

    const current = processedByReceipt.get(receiptId) ?? { halves: 0, quarters: 0 };
    const portionCode = row.portion_types?.code ?? null;
    const quantityProduced = normalizeNumber(row.quantity_produced);

    if (portionCode === "chicken_half") {
      current.halves += quantityProduced;
    }

    if (portionCode === "chicken_quarter") {
      current.quarters += quantityProduced;
    }

    processedByReceipt.set(receiptId, current);

    const explicitPackedWeightKg =
      row.post_roast_packed_weight_kg === null ? null : normalizeNumber(row.post_roast_packed_weight_kg);
    const derivedPackedWeightKg =
      explicitPackedWeightKg ??
      (() => {
        const portionWeightKg = parsePortionWeightKg(row.portion_types?.portion_label);
        return portionWeightKg ? quantityProduced * portionWeightKg : null;
      })();

    if (derivedPackedWeightKg !== null) {
      weightProcessedByReceipt.set(receiptId, (weightProcessedByReceipt.get(receiptId) ?? 0) + derivedPackedWeightKg);
    }

    if (typeof row.created_at === "string") {
      const currentLatest = latestProcessingAtByReceipt.get(receiptId);

      if (!currentLatest || new Date(row.created_at).getTime() > new Date(currentLatest).getTime()) {
        latestProcessingAtByReceipt.set(receiptId, row.created_at);
      }
    }
  });

  const mapReceiptWithProgress = (row: any) => {
    const receiptId = normalizeNumber(row.id);
    const processed = processedByReceipt.get(receiptId);
    const processedWeightKg = weightProcessedByReceipt.get(receiptId) ?? null;
    const latestProcessingAt = latestProcessingAtByReceipt.get(receiptId) ?? null;
    const hasProcessingBatch =
      processedWeightKg !== null || normalizeNumber(processed?.halves) > 0 || normalizeNumber(processed?.quarters) > 0;
    let remainingQuantity: number | null = null;

    if (row.intake_type === "protein") {
      remainingQuantity = hasProcessingBatch ? 0 : normalizeNumber(row.quantity_received);
    }

    return mapProcurementActivity(row, {
      processedHalves: processed?.halves ?? 0,
      processedQuarters: processed?.quarters ?? 0,
      processedWeightKg,
      remainingQuantity,
      hasProcessingBatch,
      latestProcessingAt
    });
  };

  const recentActivity = recentActivityRows.map(mapReceiptWithProgress);
  const processingProteinReceipts = processingReceiptRows.map(mapReceiptWithProgress);

  const visibleProcessingProteinReceipts = processingProteinReceipts.filter((entry) => {
    if (!entry.hasProcessingBatch) {
      return true;
    }

    return entry.deliveryDate === serviceDate && isWithinLastHour(entry.latestProcessingAt);
  });

  return {
    serviceDate,
    inventoryItems,
    suppliers,
    portionOptions,
    finishedStock,
    recentActivity,
    processingProteinReceipts: visibleProcessingProteinReceipts,
    recentProcessingBatches
  };
}

export async function getSuppliersPageData(selectedSupplierId?: string | null): Promise<SupplierPageData> {
  noStore();

  const supabase = createAdminSupabaseClient();
  const normalizedSelectedId = selectedSupplierId ? normalizeNumber(selectedSupplierId) : null;
  const [suppliersResponse, supplyHistoryResponse] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, phone_number, license_number, supplier_type, default_abattoir_name, is_active, notes, updated_at")
      .order("is_active", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("procurement_receipts")
      .select(
        "id, supplier_id, supplier_name, batch_number, intake_type, protein_code, item_name, quantity_received, unit_name, delivery_date, butchered_on, abattoir_name, vet_stamp_number, inspection_officer_name, note, created_at"
      )
      .order("delivery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(48)
  ]);

  ensureNoError(suppliersResponse.error, "Unable to load suppliers", procurementMigrationFiles);
  ensureNoError(supplyHistoryResponse.error, "Unable to load supplier supply history", procurementMigrationFiles);

  const suppliers = (suppliersResponse.data ?? []).map(mapSupplier);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === normalizedSelectedId) ?? null;

  return {
    suppliers,
    selectedSupplier,
    supplyHistory: (supplyHistoryResponse.data ?? []).map(mapSupplierSupplyHistory)
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
      .order("sort_order", { ascending: true }),
    supabase
      .from("inventory_items")
      .select("id, code, name, unit_name, item_type, current_quantity, reorder_threshold, is_active, updated_at")
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
      itemType: item.item_type ?? "supply",
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
  const portionTypes: PortionTypeOption[] = (portionTypesResponse.data ?? [])
    .filter((portion: any) => {
      const portionTypeId = normalizeNumber(portion.id);
      return Boolean(portion.is_active) || selectedMenuItem?.portionTypeId === portionTypeId;
    })
    .map((portion: any) => {
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

  const supabase = await createOperationsReadClient();
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
        payment_status,
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
      .in("status", ["new", "confirmed", "in_prep", "ready"])
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
        payment_status,
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
    loadDailyMenuStock(serviceDate),
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
    .filter((order) => order.paymentStatus === "paid" && order.status !== "cancelled")
    .reduce((sum, order) => sum + order.totalAmount, 0);

  const inPrepOrders = activeOrders.filter((order) => order.status === "in_prep");
  const readyOrders = activeOrders.filter((order) => order.status === "ready");
  const actionableOrders = activeOrders.filter((order) => order.status !== "new");
  const actionOrders = [...actionableOrders]
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
      inPrep: inPrepOrders.length,
      readyForPickup: readyOrders.length,
      lowStockPressure: lowStockItems.length,
      revenueToday,
      issuesNeedingAttention: issues.length
    },
    actionOrders,
    inPrepOrders,
    readyOrders,
    lowStockItems,
    issues
  };
}
