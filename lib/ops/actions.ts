"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { toCode, toInteger, toNumber, toOptionalText } from "@/lib/ops/utils";

const menuImageBucket = "menu-item-images";
const maxMenuImageBytes = 5 * 1024 * 1024;
const allowedMenuImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function requiredText(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function buildProcurementBatchNumber(proteinCode: string, deliveryDate: string) {
  const normalizedProteinCode = proteinCode.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-");
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

function revalidateOperationalPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/procurement");
  revalidatePath("/suppliers");
  revalidatePath("/inventory");
  revalidatePath("/menu");
  revalidatePath("/orders");
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
    throw new Error("Menu image must be 5MB or smaller.");
  }

  return value;
}

async function uploadMenuItemImage(menuItemId: number, file: File) {
  const supabase = createAdminSupabaseClient();
  const filePath = `menu-items/${menuItemId}/cover`;
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
  const supabase = createAdminSupabaseClient();
  const menuItemId = String(formData.get("menu_item_id") ?? "").trim();
  const name = requiredText(formData, "name");
  let code = toCode(name);

  if (menuItemId) {
    const { data: existingMenuItem, error: existingMenuItemError } = await supabase
      .from("menu_items")
      .select("code")
      .eq("id", Number(menuItemId))
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
    description: toOptionalText(formData.get("description")),
    base_price: toInteger(formData.get("base_price"), 0),
    prep_type: requiredText(formData, "prep_type"),
    menu_category_id: toInteger(formData.get("menu_category_id")),
    portion_type_id: toInteger(formData.get("portion_type_id")),
    sort_order: toInteger(formData.get("sort_order"), 1),
    is_active: formData.get("is_active") === "on",
    is_available_today: formData.get("is_available_today") === "on"
  };

  let conflictQuery = supabase
    .from("menu_items")
    .select("id, name")
    .eq("portion_type_id", payload.portion_type_id);

  if (menuItemId) {
    conflictQuery = conflictQuery.neq("id", Number(menuItemId));
  }

  const { data: conflictingMenuItem, error: conflictError } = await conflictQuery.maybeSingle();

  if (conflictError) {
    throw new Error(`Unable to validate menu item portion type: ${conflictError.message}`);
  }

  if (conflictingMenuItem) {
    return {
      ok: false as const,
      error: "That portion type is already linked to another menu item.",
      menuItemId: menuItemId ? Number(menuItemId) : null
    };
  }

  if (menuItemId) {
    const { error } = await supabase.from("menu_items").update(payload).eq("id", Number(menuItemId));

    if (error) {
      if (error.message.includes("menu_items_portion_type_id_key")) {
        return {
          ok: false as const,
          error: "That portion type is already linked to another menu item.",
          menuItemId: Number(menuItemId)
        };
      }

      throw new Error(`Unable to update menu item: ${error.message}`);
    }

    revalidateOperationalPaths();

    return {
      ok: true as const,
      menuItemId: Number(menuItemId),
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

  revalidateOperationalPaths();

  return {
    ok: true as const,
    menuItemId: data.id,
    mode: "created" as const
  };
}

export async function saveInventoryItemAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const inventoryItemId = String(formData.get("inventory_item_id") ?? "").trim();
  const codeInput = String(formData.get("code") ?? "").trim();
  const name = requiredText(formData, "name");
  const unitName = requiredText(formData, "unit_name");
  const reorderThreshold = toNumber(formData.get("reorder_threshold"), 0);
  const initialQuantity = toNumber(formData.get("initial_quantity"), 0);
  const itemType = toOptionalText(formData.get("item_type")) ?? "supply";
  const code = codeInput || toCode(name);

  if (inventoryItemId) {
    const { error } = await supabase
      .from("inventory_items")
      .update({
        code,
        name,
        unit_name: unitName,
        reorder_threshold: reorderThreshold,
        item_type: itemType,
        is_active: formData.get("is_active") === "on"
      })
      .eq("id", Number(inventoryItemId));

    if (error) {
      throw new Error(`Unable to update inventory item: ${error.message}`);
    }

    revalidateOperationalPaths();
    redirect(`/inventory?item=${inventoryItemId}`);
  }

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      code,
      name,
      unit_name: unitName,
      reorder_threshold: reorderThreshold,
      item_type: itemType,
      is_active: true
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Unable to create inventory item: ${error?.message ?? "Unknown error"}`);
  }

  if (initialQuantity !== 0) {
    const { error: adjustmentError } = await supabase.rpc("apply_inventory_adjustment", {
      p_inventory_item_id: data.id,
      p_quantity_delta: initialQuantity,
      p_movement_type: initialQuantity > 0 ? "restock" : "usage",
      p_note: "Initial quantity"
    });

    if (adjustmentError) {
      throw new Error(`Unable to apply initial inventory quantity: ${adjustmentError.message}`);
    }
  }

  revalidateOperationalPaths();
  redirect(`/inventory?item=${data.id}`);
}

export async function createInventoryItemInlineAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const codeInput = String(formData.get("code") ?? "").trim();
  const name = requiredText(formData, "name");
  const unitName = requiredText(formData, "unit_name");
  const reorderThreshold = toNumber(formData.get("reorder_threshold"), 0);
  const itemType = toOptionalText(formData.get("item_type")) ?? "supply";
  const code = codeInput || toCode(name);

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      code,
      name,
      unit_name: unitName,
      reorder_threshold: reorderThreshold,
      item_type: itemType,
      is_active: true
    })
    .select("id, code, name, unit_name, item_type, current_quantity, reorder_threshold")
    .single();

  if (error || !data) {
    throw new Error(`Unable to create inventory item: ${error?.message ?? "Unknown error"}`);
  }

  revalidateOperationalPaths();

  return {
    ok: true as const,
    item: {
      id: data.id,
      code: data.code,
      name: data.name,
      unitName: data.unit_name,
      itemType: data.item_type,
      currentQuantity: Number(data.current_quantity ?? 0),
      reorderThreshold: Number(data.reorder_threshold ?? 0)
    }
  };
}

export async function adjustInventoryItemAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const inventoryItemId = toInteger(formData.get("inventory_item_id"));
  const quantityDelta = toNumber(formData.get("quantity_delta"));
  const movementType = requiredText(formData, "movement_type");
  const note = toOptionalText(formData.get("note"));

  const { error } = await supabase.rpc("apply_inventory_adjustment", {
    p_inventory_item_id: inventoryItemId,
    p_quantity_delta: quantityDelta,
    p_movement_type: movementType,
    p_note: note
  });

  if (error) {
    throw new Error(`Unable to adjust inventory item: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect(`/inventory?item=${inventoryItemId}`);
}

export async function recordProteinProcurementAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const supplierId = toInteger(formData.get("supplier_id"));
  const proteinCode = requiredText(formData, "protein_code");
  const deliveryDate = requiredText(formData, "delivery_date");
  const batchNumber = buildProcurementBatchNumber(proteinCode, deliveryDate);
  const butcheredOn = requiredText(formData, "butchered_on");
  const abattoirName = requiredText(formData, "abattoir_name");
  const vetStampNumber = requiredText(formData, "vet_stamp_number");
  const inspectionOfficerName = requiredText(formData, "inspection_officer_name");
  const quantityReceived = toNumber(formData.get("quantity_received"));
  const unitName = requiredText(formData, "unit_name");
  const unitCost = toOptionalText(formData.get("unit_cost"));
  const note = toOptionalText(formData.get("note"));
  const allocatedToHalves = toInteger(formData.get("allocated_to_halves"), 0);
  const allocatedToQuarters = toInteger(formData.get("allocated_to_quarters"), 0);

  const { error } = await supabase.rpc("record_procurement_receipt", {
    p_intake_type: "protein",
    p_protein_code: proteinCode,
    p_inventory_item_id: null,
    p_supplier_id: supplierId,
    p_supplier_name: null,
    p_batch_number: batchNumber,
    p_delivery_date: deliveryDate,
    p_butchered_on: butcheredOn,
    p_abattoir_name: abattoirName,
    p_vet_stamp_number: vetStampNumber,
    p_inspection_officer_name: inspectionOfficerName,
    p_quantity_received: quantityReceived,
    p_unit_name: unitName,
    p_unit_cost: unitCost ? toNumber(unitCost) : null,
    p_note: note,
    p_allocated_to_halves: allocatedToHalves,
    p_allocated_to_quarters: allocatedToQuarters
  });

  if (error) {
    throw new Error(`Unable to record protein procurement: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect("/procurement");
}

export async function recordSupplyProcurementAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const inventoryItemId = toInteger(formData.get("inventory_item_id"));
  const returnTo = toOptionalText(formData.get("return_to"));
  const supplierIdValue = String(formData.get("supplier_id") ?? "").trim();
  const supplierId = supplierIdValue ? Number(supplierIdValue) : null;
  const supplierName = toOptionalText(formData.get("supplier_name"));
  const deliveryDate = requiredText(formData, "delivery_date");
  const quantityReceived = toNumber(formData.get("quantity_received"));
  const unitCost = toOptionalText(formData.get("unit_cost"));
  const note = toOptionalText(formData.get("note"));

  if (supplierId === null && !supplierName) {
    throw new Error("Supplier is required");
  }

  const { error } = await supabase.rpc("record_procurement_receipt", {
    p_intake_type: "supply",
    p_protein_code: null,
    p_inventory_item_id: inventoryItemId,
    p_supplier_id: supplierId,
    p_supplier_name: supplierName,
    p_batch_number: null,
    p_delivery_date: deliveryDate,
    p_butchered_on: null,
    p_abattoir_name: null,
    p_vet_stamp_number: null,
    p_inspection_officer_name: null,
    p_quantity_received: quantityReceived,
    p_unit_name: null,
    p_unit_cost: unitCost ? toNumber(unitCost) : null,
    p_note: note,
    p_allocated_to_halves: 0,
    p_allocated_to_quarters: 0
  });

  if (error) {
    throw new Error(`Unable to record supply procurement: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect(returnTo ?? `/inventory?item=${inventoryItemId}`);
}

export async function recordIngredientProcurementAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const inventoryItemId = toInteger(formData.get("inventory_item_id"));
  const supplierIdValue = String(formData.get("supplier_id") ?? "").trim();
  const supplierId = supplierIdValue ? Number(supplierIdValue) : null;
  const supplierName = toOptionalText(formData.get("supplier_name"));
  const deliveryDate = requiredText(formData, "delivery_date");
  const quantityReceived = toNumber(formData.get("quantity_received"));
  const unitCost = toOptionalText(formData.get("unit_cost"));
  const note = toOptionalText(formData.get("note"));

  if (supplierId === null && !supplierName) {
    throw new Error("Supplier is required");
  }

  const { error } = await supabase.rpc("record_procurement_receipt", {
    p_intake_type: "ingredient",
    p_protein_code: null,
    p_inventory_item_id: inventoryItemId,
    p_supplier_id: supplierId,
    p_supplier_name: supplierName,
    p_batch_number: null,
    p_delivery_date: deliveryDate,
    p_butchered_on: null,
    p_abattoir_name: null,
    p_vet_stamp_number: null,
    p_inspection_officer_name: null,
    p_quantity_received: quantityReceived,
    p_unit_name: null,
    p_unit_cost: unitCost ? toNumber(unitCost) : null,
    p_note: note,
    p_allocated_to_halves: 0,
    p_allocated_to_quarters: 0
  });

  if (error) {
    throw new Error(`Unable to record side ingredient procurement: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect("/procurement");
}

export async function saveSupplierAction(formData: FormData) {
  const result = await saveSupplierRecord(formData);

  revalidateOperationalPaths();

  redirect(`/suppliers?supplier=${result.supplier.id}`);
}

async function saveSupplierRecord(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  const payload = {
    name: requiredText(formData, "name"),
    phone_number: toOptionalText(formData.get("phone_number")),
    license_number: toOptionalText(formData.get("license_number")),
    supplier_type: requiredText(formData, "supplier_type"),
    default_abattoir_name: toOptionalText(formData.get("default_abattoir_name")),
    is_active: formData.get("is_active") === "on",
    notes: toOptionalText(formData.get("notes"))
  };

  if (supplierId) {
    const { data, error } = await supabase
      .from("suppliers")
      .update(payload)
      .eq("id", Number(supplierId))
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
  const result = await saveSupplierRecord(formData);

  revalidateOperationalPaths();

  return {
    ok: true as const,
    mode: result.mode,
    supplier: result.supplier
  };
}

export async function processProcurementReceiptToFinishedStockAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const procurementReceiptId = toInteger(formData.get("procurement_receipt_id"));
  const birdsAllocatedToHalves = toInteger(formData.get("birds_allocated_to_halves"), 0);
  const birdsAllocatedToQuarters = toInteger(formData.get("birds_allocated_to_quarters"), 0);
  const note = toOptionalText(formData.get("note"));

  const { data: receipt, error: receiptError } = await supabase
    .from("procurement_receipts")
    .select("protein_code")
    .eq("id", procurementReceiptId)
    .maybeSingle();

  if (receiptError) {
    throw new Error(`Unable to load procurement receipt for processing: ${receiptError.message}`);
  }

  if (!receipt) {
    throw new Error(`Unable to find procurement receipt ${procurementReceiptId}`);
  }

  if (receipt.protein_code === "whole_chicken") {
    const { error } = await supabase.rpc("process_whole_chicken_receipt_allocation", {
      p_procurement_receipt_id: procurementReceiptId,
      p_birds_allocated_to_halves: birdsAllocatedToHalves,
      p_birds_allocated_to_quarters: birdsAllocatedToQuarters,
      p_note: note
    });

    if (error) {
      throw new Error(`Unable to process whole chicken receipt allocation: ${error.message}`);
    }

    revalidateOperationalPaths();
    redirect("/procurement");
  }

  const portionTypeId = toInteger(formData.get("portion_type_id"));
  const quantityProduced = toInteger(formData.get("quantity_produced"));
  const postRoastPackedWeight = toOptionalText(formData.get("post_roast_packed_weight_kg"));

  const { error } = await supabase.rpc("process_procurement_receipt_to_finished_stock", {
    p_procurement_receipt_id: procurementReceiptId,
    p_portion_type_id: portionTypeId,
    p_quantity_produced: quantityProduced,
    p_post_roast_packed_weight_kg: postRoastPackedWeight ? toNumber(postRoastPackedWeight) : null,
    p_note: note
  });

  if (error) {
    throw new Error(`Unable to process procurement receipt into finished stock: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect("/procurement");
}

export async function saveMenuCategoryAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const name = requiredText(formData, "name");
  const code = toCode(name);
  const sortOrder = toInteger(formData.get("sort_order"), 1);

  const { error } = await supabase.from("menu_categories").upsert(
    {
      code,
      name,
      sort_order: sortOrder,
      is_active: true
    },
    {
      onConflict: "code"
    }
  );

  if (error) {
    throw new Error(`Unable to save menu category: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect("/menu");
}

export async function saveMenuItemAction(formData: FormData) {
  const imageFile = getOptionalImageFile(formData, "image");
  const result = await saveMenuItemRecord(formData);

  if (!result.ok) {
    redirect(buildMenuRedirectUrl({ editMenuItemId: result.menuItemId ? String(result.menuItemId) : null, error: result.error }));
  }

  if (imageFile) {
    await uploadMenuItemImage(result.menuItemId, imageFile);
  }

  revalidateOperationalPaths();
  redirect(`/menu?edit=${result.menuItemId}`);
}

export async function saveMenuItemDetailsAction(formData: FormData) {
  return saveMenuItemRecord(formData);
}

export async function uploadMenuItemImageAction(formData: FormData) {
  const menuItemId = toInteger(formData.get("menu_item_id"));
  const imageFile = getOptionalImageFile(formData, "image");

  if (!imageFile) {
    return {
      ok: true as const
    };
  }

  await uploadMenuItemImage(menuItemId, imageFile);
  revalidateOperationalPaths();

  return {
    ok: true as const
  };
}

export async function deleteMenuItemAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const menuItemId = toInteger(formData.get("menu_item_id"));

  const { error } = await supabase.from("menu_items").delete().eq("id", menuItemId);

  if (error) {
    throw new Error(`Unable to delete menu item: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect("/menu");
}

export async function toggleMenuItemActiveAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const menuItemId = toInteger(formData.get("menu_item_id"));
  const nextValue = String(formData.get("next_value") ?? "false") === "true";

  const { error } = await supabase.from("menu_items").update({ is_active: nextValue }).eq("id", menuItemId);

  if (error) {
    throw new Error(`Unable to update menu item status: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect("/menu");
}

export async function toggleMenuItemAvailabilityAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const menuItemId = toInteger(formData.get("menu_item_id"));
  const nextValue = String(formData.get("next_value") ?? "false") === "true";

  const { error } = await supabase.from("menu_items").update({ is_available_today: nextValue }).eq("id", menuItemId);

  if (error) {
    throw new Error(`Unable to update menu item availability: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect(`/menu?edit=${menuItemId}`);
}

export async function addMenuItemComponentAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const menuItemId = toInteger(formData.get("menu_item_id"));
  const inventoryItemId = toInteger(formData.get("inventory_item_id"));
  const quantityRequired = toNumber(formData.get("quantity_required"), 0);

  const { error } = await supabase.from("menu_item_components").upsert(
    {
      menu_item_id: menuItemId,
      inventory_item_id: inventoryItemId,
      quantity_required: quantityRequired
    },
    {
      onConflict: "menu_item_id,inventory_item_id"
    }
  );

  if (error) {
    throw new Error(`Unable to save menu item component: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect(`/menu?edit=${menuItemId}`);
}

export async function removeMenuItemComponentAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const componentId = toInteger(formData.get("component_id"));
  const menuItemId = toInteger(formData.get("menu_item_id"));

  const { error } = await supabase.from("menu_item_components").delete().eq("id", componentId);

  if (error) {
    throw new Error(`Unable to remove menu item component: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect(`/menu?edit=${menuItemId}`);
}

export async function updateOrderStatusAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const orderId = toInteger(formData.get("order_id"));
  const nextStatus = requiredText(formData, "next_status");
  const note = toOptionalText(formData.get("note"));

  const { error } = await supabase.rpc("transition_order_status", {
    p_order_id: orderId,
    p_to_status: nextStatus,
    p_note: note
  });

  if (error) {
    throw new Error(`Unable to update order status: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect(`/orders/${orderId}`);
}

export async function addOrderNoteAction(formData: FormData) {
  const supabase = createAdminSupabaseClient();
  const orderId = toInteger(formData.get("order_id"));
  const note = requiredText(formData, "note");

  const { error } = await supabase.rpc("add_order_note", {
    p_order_id: orderId,
    p_note: note
  });

  if (error) {
    throw new Error(`Unable to add order note: ${error.message}`);
  }

  revalidateOperationalPaths();
  redirect(`/orders/${orderId}`);
}
