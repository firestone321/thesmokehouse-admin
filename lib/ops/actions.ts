"use server";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  didTransitionToReady,
  triggerStorefrontReadyNotification,
  triggerStorefrontReadyQueueProcessing
} from "@/lib/ops/storefront-ready-notifications";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import {
  processAdminPushDispatchQueue,
  runAdminPushDrainWithLock
} from "@/lib/push/admin-paid-order-notifications";
import {
  addOrderNoteActionSchema,
  completeOrderWithPickupCodeActionSchema,
  ingredientProcurementActionSchema,
  inventoryAdjustmentActionSchema,
  inventoryItemActionSchema,
  menuCategoryActionSchema,
  menuItemComponentActionSchema,
  menuItemActionSchema,
  menuItemImageActionSchema,
  portionTypeActionSchema,
  processProcurementReceiptToFinishedStockActionSchema,
  proteinIntakeItemActionSchema,
  proteinProcurementActionSchema,
  queueActionSchema,
  removeMenuItemComponentActionSchema,
  supplierActionSchema,
  supplyProcurementActionSchema,
  toggleMenuItemFlagActionSchema,
  updateOrderStatusActionSchema
} from "@/lib/schemas/admin";
import { parseFormData } from "@/lib/validation/form-data";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { toCode } from "@/lib/ops/utils";

const menuImageBucket = "menu-item-images";
const maxMenuImageBytes = 10 * 1024 * 1024;
const allowedMenuImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function buildProcurementBatchNumber(sourceCode: string, deliveryDate: string) {
  const normalizedProteinCode = sourceCode.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-");
  const normalizedDate = deliveryDate.replaceAll("-", "");
  const timestamp = new Date();
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kampala",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const formattedTime = timeFormatter.format(timestamp).replaceAll(":", "");

  return `${normalizedProteinCode}-${normalizedDate}-${formattedTime}`;
}

async function getInventoryItemBatchCode(inventoryItemId: number) {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.from("inventory_items").select("code").eq("id", inventoryItemId).maybeSingle();

  if (error) {
    throw new Error(`Unable to load inventory item batch code: ${error.message}`);
  }

  if (!data?.code) {
    throw new Error(`Unable to find inventory item ${inventoryItemId}`);
  }

  return data.code;
}

const businessTruthHealthTag = "business-truth-health-snapshot";

function revalidatePaths(paths: string[]) {
  for (const path of new Set(paths)) {
    revalidatePath(path);
  }
}

function revalidateBusinessTruthHealth() {
  revalidateTag(businessTruthHealthTag, "max");
}

function revalidateOrderPaths(orderId?: number | string) {
  revalidatePaths(["/dashboard", "/orders", "/orders/history", orderId ? `/orders/${orderId}` : ""].filter(Boolean));
  revalidateBusinessTruthHealth();
}

function revalidatePushQueuePaths() {
  revalidatePaths(["/orders"]);
}

function revalidateInventoryPaths() {
  revalidatePaths(["/dashboard", "/inventory"]);
  revalidateBusinessTruthHealth();
}

function revalidateProcurementPaths() {
  revalidatePaths(["/dashboard", "/procurement", "/inventory", "/suppliers"]);
  revalidateBusinessTruthHealth();
}

function revalidateSupplierPaths() {
  revalidatePaths(["/procurement", "/suppliers"]);
}

function revalidateMenuPaths() {
  revalidatePaths(["/menu", "/procurement"]);
}

function buildOrdersFlashRedirect(returnTo: string, status: "success" | "error", message: string) {
  const url = new URL(returnTo, "http://smokehouse.local");
  url.searchParams.set("push_queue_status", status);
  url.searchParams.set("push_queue_message", message);
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildMenuRedirectUrl(options?: { editMenuItemId?: string | null; error?: string | null }) {
  const params = new URLSearchParams();

  if (options?.editMenuItemId) {
    params.set("edit", options.editMenuItemId);
  }

  if (options?.error) {
    params.set("error", options.error);
  }

  const query = params.toString();
  return query.length > 0 ? `/menu?${query}` : "/menu";
}

function getOptionalImageFile(formData: FormData, key: string) {
  const value = formData.get(key);

  if (!(value instanceof File) || value.size === 0) {
    return null;
  }

  if (!allowedMenuImageTypes.has(value.type)) {
    throw new Error("Menu image must be a JPG, PNG, or WebP file.");
  }

  if (value.size > maxMenuImageBytes) {
    throw new Error("Menu image must be 10MB or smaller.");
  }

  return value;
}

async function uploadMenuItemImage(menuItemId: number, file: File) {
  const supabase = createAdminSupabaseClient();
  const filePath = `menu-items/${menuItemId}/${randomUUID()}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage.from(menuImageBucket).upload(filePath, arrayBuffer, {
    contentType: file.type,
    upsert: true
  });

  if (uploadError) {
    throw new Error(`Unable to upload menu image: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(menuImageBucket).getPublicUrl(filePath);
  const { error: updateError } = await supabase
    .from("menu_items")
    .update({ image_url: data.publicUrl })
    .eq("id", menuItemId);

  if (updateError) {
    throw new Error(`Unable to save menu image URL: ${updateError.message}`);
  }
}

async function saveMenuItemRecord(formData: FormData) {
  const input = parseFormData(formData, menuItemActionSchema);
  const supabase = createAdminSupabaseClient();
  const menuItemId = input.menu_item_id;
  const name = input.name;
  let code = toCode(name);

  if (menuItemId) {
    const { data: existingMenuItem, error: existingMenuItemError } = await supabase
      .from("menu_items")
      .select("code")
      .eq("id", menuItemId)
      .maybeSingle();

    if (existingMenuItemError) {
      throw new Error(`Unable to load existing menu item: ${existingMenuItemError.message}`);
    }

    if (!existingMenuItem) {
      throw new Error(`Unable to find menu item ${menuItemId}`);
    }

    code = existingMenuItem.code;
  }

  const payload = {
    code,
    name,
    description: input.description,
    base_price: input.base_price,
    prep_type: input.prep_type,
    menu_category_id: input.menu_category_id,
    portion_type_id: input.portion_type_id,
    sort_order: input.sort_order,
    is_active: input.is_active,
    is_available_today: input.is_available_today
  };

  let conflictQuery = supabase
    .from("menu_items")
    .select("id, name")
    .eq("portion_type_id", payload.portion_type_id);

  if (menuItemId) {
    conflictQuery = conflictQuery.neq("id", menuItemId);
  }

  const { data: conflictingMenuItem, error: conflictError } = await conflictQuery.maybeSingle();

  if (conflictError) {
    throw new Error(`Unable to validate menu item portion type: ${conflictError.message}`);
  }

  if (conflictingMenuItem) {
    return {
      ok: false as const,
      error: "That portion type is already linked to another menu item.",
      menuItemId
    };
  }

  if (menuItemId) {
    const { error } = await supabase.from("menu_items").update(payload).eq("id", menuItemId);

    if (error) {
      if (error.message.includes("menu_items_portion_type_id_key")) {
        return {
          ok: false as const,
          error: "That portion type is already linked to another menu item.",
          menuItemId
        };
      }

      throw new Error(`Unable to update menu item: ${error.message}`);
    }

    revalidateMenuPaths();

    return {
      ok: true as const,
      menuItemId,
      mode: "updated" as const
    };
  }

  const { data, error } = await supabase.from("menu_items").insert(payload).select("id").single();

  if (error || !data) {
    if (error?.message.includes("menu_items_portion_type_id_key")) {
      return {
        ok: false as const,
        error: "That portion type is already linked to another menu item.",
        menuItemId: null
      };
    }

    throw new Error(`Unable to create menu item: ${error?.message ?? "Unknown error"}`);
  }

  revalidateMenuPaths();

  return {
    ok: true as const,
    menuItemId: data.id,
    mode: "created" as const
  };
}

export async function saveInventoryItemAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, inventoryItemActionSchema);
  const supabase = createAdminSupabaseClient();
  const inventoryItemId = input.inventory_item_id;
  const code = input.code ?? toCode(input.name);

  if (inventoryItemId) {
    const { error } = await supabase
      .from("inventory_items")
      .update({
        code,
        name: input.name,
        unit_name: input.unit_name,
        reorder_threshold: input.reorder_threshold,
        item_type: input.item_type,
        is_active: input.is_active
      })
      .eq("id", inventoryItemId);

    if (error) {
      throw new Error(`Unable to update inventory item: ${error.message}`);
    }

    revalidateInventoryPaths();
    redirect(`/inventory?item=${inventoryItemId}`);
  }

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      code,
      name: input.name,
      unit_name: input.unit_name,
      reorder_threshold: input.reorder_threshold,
      item_type: input.item_type,
      is_active: true
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Unable to create inventory item: ${error?.message ?? "Unknown error"}`);
  }

  if (input.initial_quantity !== 0) {
    const { error: adjustmentError } = await supabase.rpc("apply_inventory_adjustment", {
      p_inventory_item_id: data.id,
      p_quantity_delta: input.initial_quantity,
      p_movement_type: input.initial_quantity > 0 ? "restock" : "usage",
      p_note: "Initial quantity"
    });

    if (adjustmentError) {
      throw new Error(`Unable to apply initial inventory quantity: ${adjustmentError.message}`);
    }
  }

  revalidateInventoryPaths();
  redirect(`/inventory?item=${data.id}`);
}

export async function processAdminPushQueueAction(formData: FormData) {
  await requireApprovedAdminRole();
  const { return_to: returnTo } = parseFormData(formData, queueActionSchema);
  const stats = await processAdminPushDispatchQueue({ limit: 10 });

  revalidatePushQueuePaths();
  redirect(
    buildOrdersFlashRedirect(
      returnTo,
      "success",
      `Admin queue processed. Claimed ${stats.claimed}, delivered ${stats.succeeded}, retried ${stats.retried}, failed ${stats.failed}.`
    )
  );
}

export async function processStorefrontReadyQueueAction(formData: FormData) {
  await requireApprovedAdminRole();
  const { return_to: returnTo } = parseFormData(formData, queueActionSchema);
  const result = await triggerStorefrontReadyQueueProcessing(10);

  revalidatePushQueuePaths();

  if (!result.configured) {
    redirect(buildOrdersFlashRedirect(returnTo, "error", "Storefront Ready queue kickoff is not configured yet."));
  }

  if (!result.accepted || !result.stats) {
    redirect(buildOrdersFlashRedirect(returnTo, "error", "Storefront Ready queue could not be processed right now."));
  }

  redirect(
    buildOrdersFlashRedirect(
      returnTo,
      "success",
      `Ready queue processed. Scanned ${result.stats.scanned}, completed ${result.stats.completed}, retried ${result.stats.retried}, failed ${result.stats.failed}.`
    )
  );
}

export async function createInventoryItemInlineAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, inventoryItemActionSchema);
  const supabase = createAdminSupabaseClient();
  const code = input.code ?? toCode(input.name);

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      code,
      name: input.name,
      unit_name: input.unit_name,
      reorder_threshold: input.reorder_threshold,
      item_type: input.item_type,
      is_active: true
    })
    .select(
      "id, code, name, unit_name, item_type, current_quantity, reorder_threshold, direct_sellable_portion_type_id, sellable_units_per_input, requires_whole_input"
    )
    .single();

  if (error || !data) {
    throw new Error(`Unable to create inventory item: ${error?.message ?? "Unknown error"}`);
  }

  revalidateInventoryPaths();
  revalidateMenuPaths();

  return {
    ok: true as const,
    item: {
      id: data.id,
      code: data.code,
      name: data.name,
      displayName: data.name,
      unitName: data.unit_name,
      itemType: data.item_type,
      currentQuantity: Number(data.current_quantity ?? 0),
      reorderThreshold: Number(data.reorder_threshold ?? 0),
      directSellablePortionTypeId: data.direct_sellable_portion_type_id
        ? Number(data.direct_sellable_portion_type_id)
        : null,
      sellableUnitsPerInput: Number(data.sellable_units_per_input ?? 1),
      requiresWholeInput: Boolean(data.requires_whole_input)
    }
  };
}

export async function adjustInventoryItemAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, inventoryAdjustmentActionSchema);
  const supabase = createAdminSupabaseClient();

  const { error } = await supabase.rpc("apply_inventory_adjustment", {
    p_inventory_item_id: input.inventory_item_id,
    p_quantity_delta: input.quantity_delta,
    p_movement_type: input.movement_type,
    p_note: input.note
  });

  if (error) {
    throw new Error(`Unable to adjust inventory item: ${error.message}`);
  }

  revalidateInventoryPaths();
  redirect(`/inventory?item=${input.inventory_item_id}`);
}

export async function recordProteinProcurementAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, proteinProcurementActionSchema);
  const supabase = createAdminSupabaseClient();
  const { data: proteinItem, error: proteinItemError } = await supabase
    .from("protein_intake_items")
    .select("code")
    .eq("id", input.protein_intake_item_id)
    .eq("is_active", true)
    .maybeSingle();

  if (proteinItemError) {
    throw new Error(`Unable to load protein intake item: ${proteinItemError.message}`);
  }

  if (!proteinItem?.code) {
    throw new Error("Select an active protein intake item.");
  }

  const batchNumber = buildProcurementBatchNumber(proteinItem.code, input.delivery_date);

  const { error } = await supabase.rpc("record_protein_procurement_receipt", {
    p_protein_intake_item_id: input.protein_intake_item_id,
    p_supplier_id: input.supplier_id,
    p_batch_number: batchNumber,
    p_delivery_date: input.delivery_date,
    p_butchered_on: input.butchered_on,
    p_abattoir_name: input.abattoir_name,
    p_vet_stamp_number: input.vet_stamp_number,
    p_inspection_officer_name: input.inspection_officer_name,
    p_quantity_received: input.quantity_received,
    p_unit_name: input.unit_name,
    p_unit_cost: input.unit_cost,
    p_note: input.note,
    p_allocated_to_halves: input.allocated_to_halves,
    p_allocated_to_quarters: input.allocated_to_quarters
  });

  if (error) {
    throw new Error(`Unable to record protein procurement: ${error.message}`);
  }

  revalidateProcurementPaths();
  redirect("/procurement");
}

export async function createProteinIntakeItemInlineAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, proteinIntakeItemActionSchema);
  const supabase = createAdminSupabaseClient();
  const code = toCode(input.name);

  const { data, error } = await supabase.rpc("create_protein_intake_item", {
    p_code: code,
    p_name: input.name,
    p_default_unit_name: input.default_unit_name,
    p_protein_id: input.protein_id,
    p_portion_type_id: input.portion_type_id
  });

  let item = Array.isArray(data) ? data[0] : data;

  if (error?.code === "23505" || error?.message.toLowerCase().includes("duplicate key")) {
    const { data: existingItem, error: existingItemError } = await supabase
      .from("protein_intake_items")
      .select(
        `
          id,
          code,
          name,
          default_unit_name,
          protein_id,
          processing_mode,
          is_active,
          protein_intake_item_portions (portion_type_id)
        `
      )
      .eq("code", code)
      .maybeSingle();

    if (existingItemError) {
      throw new Error(`Unable to load existing protein intake item: ${existingItemError.message}`);
    }

    const portionTypeIds = (existingItem?.protein_intake_item_portions ?? []).map((mapping: any) =>
      Number(mapping.portion_type_id)
    );

    if (
      !existingItem?.is_active ||
      Number(existingItem.protein_id) !== input.protein_id ||
      existingItem.processing_mode !== "standard_weight" ||
      !portionTypeIds.includes(input.portion_type_id)
    ) {
      throw new Error(
        `A protein item with code "${code}" already exists with different setup. Apply the latest protein intake registry migration before retrying.`
      );
    }

    item = {
      ...existingItem,
      portion_type_id: input.portion_type_id
    };
  } else if (error) {
    throw new Error(`Unable to create protein intake item: ${error.message}`);
  }

  if (!item) {
    throw new Error("Unable to create protein intake item: Unknown error");
  }

  return {
    ok: true as const,
    item: {
      id: Number(item.id),
      code: item.code as string,
      name: item.name as string,
      defaultUnitName: item.default_unit_name as string,
      proteinId: Number(item.protein_id),
      processingMode: item.processing_mode as "standard_weight" | "whole_bird",
      portionTypeIds: [Number(item.portion_type_id)],
      isActive: true
    }
  };
}

export async function recordSupplyProcurementAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, supplyProcurementActionSchema);
  const supabase = createAdminSupabaseClient();
  const batchNumber = buildProcurementBatchNumber(
    await getInventoryItemBatchCode(input.inventory_item_id),
    input.delivery_date
  );
  const returnTo = input.return_to ?? `/inventory?item=${input.inventory_item_id}`;

  if (input.supplier_id === null && !input.supplier_name) {
    throw new Error("Supplier is required");
  }

  const { error } = await supabase.rpc("record_procurement_receipt", {
    p_intake_type: "supply",
    p_protein_code: null,
    p_inventory_item_id: input.inventory_item_id,
    p_supplier_id: input.supplier_id,
    p_supplier_name: input.supplier_name,
    p_batch_number: batchNumber,
    p_delivery_date: input.delivery_date,
    p_butchered_on: null,
    p_abattoir_name: null,
    p_vet_stamp_number: null,
    p_inspection_officer_name: null,
    p_quantity_received: input.quantity_received,
    p_unit_name: null,
    p_unit_cost: input.unit_cost,
    p_note: input.note,
    p_allocated_to_halves: 0,
    p_allocated_to_quarters: 0
  });

  if (error) {
    throw new Error(`Unable to record supply procurement: ${error.message}`);
  }

  revalidateProcurementPaths();
  redirect(returnTo);
}

export async function recordIngredientProcurementAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, ingredientProcurementActionSchema);
  const supabase = createAdminSupabaseClient();
  const { data: inventoryItem, error: inventoryItemError } = await supabase
    .from("inventory_items")
    .select("code, direct_sellable_portion_type_id")
    .eq("id", input.inventory_item_id)
    .eq("is_active", true)
    .maybeSingle();

  if (inventoryItemError) {
    throw new Error(`Unable to load sides and drinks intake item: ${inventoryItemError.message}`);
  }

  if (!inventoryItem?.code) {
    throw new Error("Select an active sides or drinks intake item.");
  }

  const batchNumber = buildProcurementBatchNumber(inventoryItem.code, input.delivery_date);

  if (input.supplier_id === null && !input.supplier_name) {
    throw new Error("Supplier is required");
  }

  const { error } = inventoryItem.direct_sellable_portion_type_id
    ? await supabase.rpc("record_direct_sellable_procurement_receipt", {
      p_inventory_item_id: input.inventory_item_id,
      p_supplier_id: input.supplier_id,
      p_supplier_name: input.supplier_name,
      p_batch_number: batchNumber,
      p_delivery_date: input.delivery_date,
      p_quantity_received: input.quantity_received,
      p_unit_cost: input.unit_cost,
      p_note: input.note
    })
    : await supabase.rpc("record_procurement_receipt", {
      p_intake_type: "ingredient",
      p_protein_code: null,
      p_inventory_item_id: input.inventory_item_id,
      p_supplier_id: input.supplier_id,
      p_supplier_name: input.supplier_name,
      p_batch_number: batchNumber,
      p_delivery_date: input.delivery_date,
      p_butchered_on: null,
      p_abattoir_name: null,
      p_vet_stamp_number: null,
      p_inspection_officer_name: null,
      p_quantity_received: input.quantity_received,
      p_unit_name: null,
      p_unit_cost: input.unit_cost,
      p_note: input.note,
      p_allocated_to_halves: 0,
      p_allocated_to_quarters: 0
    });

  if (error) {
    throw new Error(`Unable to record sides and drinks intake: ${error.message}`);
  }

  revalidateProcurementPaths();
  redirect("/procurement");
}

export async function saveSupplierAction(formData: FormData) {
  await requireApprovedAdminRole();
  const result = await saveSupplierRecord(formData);

  revalidateSupplierPaths();

  redirect(`/suppliers?supplier=${result.supplier.id}`);
}

async function saveSupplierRecord(formData: FormData) {
  const input = parseFormData(formData, supplierActionSchema);
  const supabase = createAdminSupabaseClient();
  const payload = {
    name: input.name,
    phone_number: input.phone_number,
    license_number: input.license_number,
    supplier_type: input.supplier_type,
    default_abattoir_name: input.default_abattoir_name,
    is_active: input.is_active,
    notes: input.notes
  };

  if (input.supplier_id) {
    const { data, error } = await supabase
      .from("suppliers")
      .update(payload)
      .eq("id", input.supplier_id)
      .select("id, name, phone_number, license_number, supplier_type, default_abattoir_name, is_active")
      .single();

    if (error || !data) {
      throw new Error(`Unable to update supplier: ${error?.message ?? "Unknown error"}`);
    }

    return {
      mode: "updated" as const,
      supplier: {
        id: data.id,
        name: data.name,
        phoneNumber: data.phone_number,
        licenseNumber: data.license_number,
        supplierType: data.supplier_type,
        defaultAbattoirName: data.default_abattoir_name,
        isActive: data.is_active
      }
    };
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert(payload)
    .select("id, name, phone_number, license_number, supplier_type, default_abattoir_name, is_active")
    .single();

  if (error || !data) {
    throw new Error(`Unable to create supplier: ${error?.message ?? "Unknown error"}`);
  }

  return {
    mode: "created" as const,
    supplier: {
      id: data.id,
      name: data.name,
      phoneNumber: data.phone_number,
      licenseNumber: data.license_number,
      supplierType: data.supplier_type,
      defaultAbattoirName: data.default_abattoir_name,
      isActive: data.is_active
    }
  };
}

export async function createSupplierInlineAction(formData: FormData) {
  await requireApprovedAdminRole();
  const result = await saveSupplierRecord(formData);

  revalidateSupplierPaths();

  return {
    ok: true as const,
    mode: result.mode,
    supplier: result.supplier
  };
}

async function savePortionTypeRecord(formData: FormData) {
  const input = parseFormData(formData, portionTypeActionSchema);
  const supabase = createAdminSupabaseClient();
  const code = toCode(input.name);

  const { data: existingPortionType, error: existingPortionTypeError } = await supabase
    .from("portion_types")
    .select("id")
    .eq("code", code)
    .maybeSingle();

  if (existingPortionTypeError) {
    throw new Error(`Unable to validate portion type code: ${existingPortionTypeError.message}`);
  }

  if (existingPortionType) {
    throw new Error("A portion type with that name already exists.");
  }

  const { data: latestPortionType, error: latestPortionTypeError } = await supabase
    .from("portion_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestPortionTypeError) {
    throw new Error(`Unable to determine the next portion sort order: ${latestPortionTypeError.message}`);
  }

  const nextSortOrder = Number(latestPortionType?.sort_order ?? 0) + 1;
  const portionLabel = `${input.quantity}${input.unit}`;

  const { data, error } = await supabase
    .from("portion_types")
    .insert({
      code,
      name: input.name,
      portion_label: portionLabel,
      protein_id: null,
      packaging_type_id: null,
      sort_order: nextSortOrder,
      is_active: true
    })
    .select("id, code, name, portion_label")
    .single();

  if (error || !data) {
    throw new Error(`Unable to create portion type: ${error?.message ?? "Unknown error"}`);
  }

  return {
    id: data.id,
    code: data.code,
    label: `${data.name}${data.portion_label ? ` (${data.portion_label})` : ""}`,
    isAssigned: false
  };
}

export async function createPortionTypeInlineAction(formData: FormData) {
  await requireApprovedAdminRole();
  const portionType = await savePortionTypeRecord(formData);

  revalidateMenuPaths();

  return {
    ok: true as const,
    portionType
  };
}

export async function processProcurementReceiptToFinishedStockAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, processProcurementReceiptToFinishedStockActionSchema);
  const supabase = createAdminSupabaseClient();

  const { data: receipt, error: receiptError } = await supabase
    .from("procurement_receipts")
    .select("protein_code")
    .eq("id", input.procurement_receipt_id)
    .maybeSingle();

  if (receiptError) {
    throw new Error(`Unable to load procurement receipt for processing: ${receiptError.message}`);
  }

  if (!receipt) {
    throw new Error(`Unable to find procurement receipt ${input.procurement_receipt_id}`);
  }

  if (receipt.protein_code === "whole_chicken") {
    const { error } = await supabase.rpc("process_whole_chicken_receipt_allocation", {
      p_procurement_receipt_id: input.procurement_receipt_id,
      p_birds_allocated_to_halves: input.birds_allocated_to_halves,
      p_birds_allocated_to_quarters: input.birds_allocated_to_quarters,
      p_note: input.note
    });

    if (error) {
      throw new Error(`Unable to process whole chicken receipt allocation: ${error.message}`);
    }

    revalidateProcurementPaths();
    redirect("/procurement");
  }

  if (input.portion_type_id === null || input.quantity_produced === null) {
    throw new Error("Portion type and quantity produced are required.");
  }

  const { error } = await supabase.rpc("process_procurement_receipt_to_finished_stock", {
    p_procurement_receipt_id: input.procurement_receipt_id,
    p_portion_type_id: input.portion_type_id,
    p_quantity_produced: input.quantity_produced,
    p_post_roast_packed_weight_kg: input.post_roast_packed_weight_kg,
    p_note: input.note
  });

  if (error) {
    throw new Error(`Unable to process procurement receipt into finished stock: ${error.message}`);
  }

  revalidateProcurementPaths();
  redirect("/procurement");
}

export async function saveMenuCategoryAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, menuCategoryActionSchema);
  const supabase = createAdminSupabaseClient();
  const code = toCode(input.name);

  const { error } = await supabase.from("menu_categories").upsert(
    {
      code,
      name: input.name,
      sort_order: input.sort_order,
      is_active: true
    },
    {
      onConflict: "code"
    }
  );

  if (error) {
    throw new Error(`Unable to save menu category: ${error.message}`);
  }

  revalidateMenuPaths();
  redirect("/menu");
}

export async function saveMenuItemAction(formData: FormData) {
  await requireApprovedAdminRole();
  const imageFile = getOptionalImageFile(formData, "image");
  const result = await saveMenuItemRecord(formData);

  if (!result.ok) {
    redirect(buildMenuRedirectUrl({ editMenuItemId: result.menuItemId ? String(result.menuItemId) : null, error: result.error }));
  }

  if (imageFile) {
    await uploadMenuItemImage(result.menuItemId, imageFile);
  }

  revalidateMenuPaths();
  redirect(`/menu?edit=${result.menuItemId}`);
}

export async function saveMenuItemDetailsAction(formData: FormData) {
  await requireApprovedAdminRole();
  return saveMenuItemRecord(formData);
}

export async function uploadMenuItemImageAction(formData: FormData) {
  await requireApprovedAdminRole();
  const { menu_item_id: menuItemId } = parseFormData(formData, menuItemImageActionSchema);
  const imageFile = getOptionalImageFile(formData, "image");

  if (!imageFile) {
    return {
      ok: true as const
    };
  }

  await uploadMenuItemImage(menuItemId, imageFile);
  revalidateMenuPaths();

  return {
    ok: true as const
  };
}

export async function deleteMenuItemAction(formData: FormData) {
  await requireApprovedAdminRole();
  const { menu_item_id: menuItemId } = parseFormData(formData, menuItemImageActionSchema);
  const supabase = createAdminSupabaseClient();

  const { error } = await supabase.from("menu_items").delete().eq("id", menuItemId);

  if (error) {
    throw new Error(`Unable to delete menu item: ${error.message}`);
  }

  revalidateMenuPaths();
  redirect("/menu");
}

export async function toggleMenuItemActiveAction(formData: FormData) {
  await requireApprovedAdminRole();
  const { menu_item_id: menuItemId, next_value: nextValue } = parseFormData(formData, toggleMenuItemFlagActionSchema);
  const supabase = createAdminSupabaseClient();

  const { error } = await supabase.from("menu_items").update({ is_active: nextValue }).eq("id", menuItemId);

  if (error) {
    throw new Error(`Unable to update menu item status: ${error.message}`);
  }

  revalidateMenuPaths();
  redirect("/menu");
}

export async function toggleMenuItemAvailabilityAction(formData: FormData) {
  await requireApprovedAdminRole();
  const { menu_item_id: menuItemId, next_value: nextValue } = parseFormData(formData, toggleMenuItemFlagActionSchema);
  const supabase = createAdminSupabaseClient();

  const { error } = await supabase.from("menu_items").update({ is_available_today: nextValue }).eq("id", menuItemId);

  if (error) {
    throw new Error(`Unable to update menu item availability: ${error.message}`);
  }

  revalidateMenuPaths();
  redirect(`/menu?edit=${menuItemId}`);
}

export async function addMenuItemComponentAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, menuItemComponentActionSchema);
  const supabase = createAdminSupabaseClient();

  const { error } = await supabase.from("menu_item_components").upsert(
    {
      menu_item_id: input.menu_item_id,
      inventory_item_id: input.inventory_item_id,
      quantity_required: input.quantity_required
    },
    {
      onConflict: "menu_item_id,inventory_item_id"
    }
  );

  if (error) {
    throw new Error(`Unable to save menu item component: ${error.message}`);
  }

  revalidateMenuPaths();
  redirect(`/menu?edit=${input.menu_item_id}`);
}

export async function removeMenuItemComponentAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, removeMenuItemComponentActionSchema);
  const supabase = createAdminSupabaseClient();

  const { error } = await supabase.from("menu_item_components").delete().eq("id", input.component_id);

  if (error) {
    throw new Error(`Unable to remove menu item component: ${error.message}`);
  }

  revalidateMenuPaths();
  redirect(`/menu?edit=${input.menu_item_id}`);
}

export async function updateOrderStatusAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, updateOrderStatusActionSchema);
  const supabase = createAdminSupabaseClient();
  const orderId = input.order_id;
  const nextStatus = input.next_status;
  const note = input.note ?? null;

  if (nextStatus === "completed") {
    redirect(`/orders/${orderId}?error=${encodeURIComponent("Use the pickup code form to complete this order.")}`);
  }

  const { error } = await supabase.rpc("transition_order_status", {
    p_order_id: orderId,
    p_to_status: nextStatus,
    p_note: note
  });

  if (error) {
    throw new Error(`Unable to update order status: ${error.message}`);
  }

  if (nextStatus === "in_prep") {
    after(async () => {
      try {
        await runAdminPushDrainWithLock(async () => {
          await processAdminPushDispatchQueue({ orderId, limit: 2 });
        });
      } catch (pushError) {
        console.error("chef_in_prep_push_process_failed", {
          orderId,
          error: pushError instanceof Error ? pushError.message : "unknown_error"
        });
      }
    });
  }

  if (nextStatus === "ready") {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,status,updated_at")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      console.error("storefront_ready_notification_order_lookup_failed", {
        orderId,
        error: orderError.message
      });
    } else if (didTransitionToReady({ requestedStatus: nextStatus, order })) {
      const readyOrder = order as { id: number; updated_at: string };
      await triggerStorefrontReadyNotification({
        id: readyOrder.id,
        updatedAt: readyOrder.updated_at
      });
    }
  }

  revalidateOrderPaths(orderId);
  redirect(`/orders/${orderId}`);
}

function pickupCodesMatch(stored: string, submitted: string): boolean {
  const storedBuf = Buffer.from(stored, "utf8");
  const submittedBuf = Buffer.from(submitted, "utf8");
  if (storedBuf.length !== submittedBuf.length) {
    timingSafeEqual(storedBuf, storedBuf);
    return false;
  }
  return timingSafeEqual(storedBuf, submittedBuf);
}

function formatPickupLockoutTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala"
  });
}

export async function completeOrderWithPickupCodeAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, completeOrderWithPickupCodeActionSchema);
  const supabase = createAdminSupabaseClient();
  const orderId = input.order_id;
  const pickupCode = input.pickup_code;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, pickup_code, pickup_code_locked_until")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    throw new Error(`Unable to verify pickup code: ${orderError.message}`);
  }

  if (!order) {
    redirect(`/orders/${orderId}?error=${encodeURIComponent("That order could not be found.")}`);
  }

  if (order.status !== "ready") {
    redirect(`/orders/${orderId}?error=${encodeURIComponent("Only orders marked ready can be completed with a pickup code.")}`);
  }

  if (!order.pickup_code) {
    redirect(`/orders/${orderId}?error=${encodeURIComponent("This order does not have a pickup code yet.")}`);
  }

  if (order.pickup_code_locked_until && new Date(order.pickup_code_locked_until).getTime() > Date.now()) {
    const unlockTime = formatPickupLockoutTime(order.pickup_code_locked_until);
    redirect(`/orders/${orderId}?error=${encodeURIComponent(`Too many failed pickup code attempts. Locked until ${unlockTime}.`)}`);
  }

  if (!pickupCodesMatch(order.pickup_code, pickupCode)) {
    const { data: lockResult, error: lockError } = await supabase
      .rpc("register_pickup_code_failure", { p_order_id: orderId })
      .maybeSingle<{ failed_attempts: number; locked_until: string | null }>();

    if (lockError) {
      console.error("pickup_code_failure_register_failed", {
        orderId,
        error: lockError.message
      });
    }

    const lockedUntil = lockResult?.locked_until ?? null;
    const message = lockedUntil
      ? `Too many failed pickup code attempts. Locked until ${formatPickupLockoutTime(lockedUntil)}.`
      : "Pickup code did not match. Ask the customer to show the code in their app again.";
    redirect(`/orders/${orderId}?error=${encodeURIComponent(message)}`);
  }

  const { error: clearError } = await supabase.rpc("clear_pickup_code_lock", {
    p_order_id: orderId
  });
  if (clearError) {
    console.error("pickup_code_clear_failed", { orderId, error: clearError.message });
  }

  const { error } = await supabase.rpc("transition_order_status", {
    p_order_id: orderId,
    p_to_status: "completed",
    p_note: "Completed after pickup code verification."
  });

  if (error) {
    throw new Error(`Unable to complete order: ${error.message}`);
  }

  revalidateOrderPaths(orderId);
  redirect(`/orders/${orderId}`);
}

export async function addOrderNoteAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, addOrderNoteActionSchema);
  const supabase = createAdminSupabaseClient();
  const orderId = input.order_id;
  const note = input.note;

  const { error } = await supabase.rpc("add_order_note", {
    p_order_id: orderId,
    p_note: note
  });

  if (error) {
    throw new Error(`Unable to add order note: ${error.message}`);
  }

  revalidateOrderPaths(orderId);
  redirect(`/orders/${orderId}`);
}
