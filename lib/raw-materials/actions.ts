"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { recordStaffActivity } from "@/lib/activity/log";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function positiveNumber(value: string) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }
function positiveInteger(value: string) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }

export async function createRawMaterialAction(formData: FormData) {
  const actor = await requireApprovedAdminRole();
  const name = text(formData, "name");
  const category = text(formData, "category");
  const unitName = text(formData, "unit_name");
  if (!name || !["edible", "non_edible"].includes(category) || !unitName) redirect("/raw-materials?error=Enter a valid material, category, and unit.");
  const { data, error } = await createAdminSupabaseClient().from("raw_materials").insert({ name, category, unit_name: unitName }).select("id").single();
  if (error) redirect(`/raw-materials?error=${encodeURIComponent(error.message)}`);
  await recordStaffActivity({ actor, action: "raw_material.created", entityType: "raw_material", entityId: data.id, summary: `${actor.email ?? "Staff"} created Raw Material ${name}.`, metadata: { category, unitName } });
  revalidatePath("/raw-materials");
  redirect("/raw-materials");
}

export async function recordRawMaterialInputAction(formData: FormData) {
  const actor = await requireApprovedAdminRole();
  const materialId = positiveInteger(text(formData, "raw_material_id"));
  const supplierId = positiveInteger(text(formData, "supplier_id"));
  const quantity = positiveNumber(text(formData, "quantity"));
  const totalCostUgx = positiveInteger(text(formData, "total_cost_ugx"));
  const receivedDate = text(formData, "received_date");
  const notes = text(formData, "notes") || null;
  const idempotencyKey = text(formData, "idempotency_key");
  if (!materialId || !supplierId || !quantity || !totalCostUgx || !idempotencyKey || !/^\d{4}-\d{2}-\d{2}$/.test(receivedDate)) redirect("/raw-materials?error=Complete all purchase fields with valid positive values.");
  const { error } = await createAdminSupabaseClient().rpc("record_raw_material_purchase", { p_raw_material_id: materialId, p_supplier_id: supplierId, p_quantity: quantity, p_total_cost_ugx: totalCostUgx, p_received_date: receivedDate, p_notes: notes, p_source: "manual", p_import_batch_id: null, p_created_by: actor.userId, p_idempotency_key: idempotencyKey });
  if (error) redirect(`/raw-materials?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/raw-materials");
  revalidatePath("/reports");
  redirect("/raw-materials");
}

export async function importRawMaterialsAction(formData: FormData) {
  const actor = await requireApprovedAdminRole();
  let rows: unknown;
  try { rows = JSON.parse(text(formData, "rows")); } catch { redirect("/raw-materials?error=The import preview is invalid."); }
  const importHash = text(formData, "import_hash");
  const batchNumber = text(formData, "batch_number");
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500 || !importHash || !batchNumber) redirect("/raw-materials?error=Import confirmation data is invalid. Re-upload the workbook.");
  const { error } = await createAdminSupabaseClient().rpc("record_raw_material_import", { p_batch_number: batchNumber, p_import_hash: importHash, p_filename: text(formData, "filename") || "raw-materials.xlsx", p_rows: rows, p_imported_by: actor.userId });
  if (error) redirect(`/raw-materials?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/raw-materials");
  revalidatePath("/reports");
  redirect("/raw-materials");
}