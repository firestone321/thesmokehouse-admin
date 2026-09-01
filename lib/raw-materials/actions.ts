"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { recordStaffActivity } from "@/lib/activity/log";
import { getUgandaServiceDate } from "@/lib/ops/utils";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function positiveNumber(value: string) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }
function positiveInteger(value: string) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
function normalizedName(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function importText(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
type ReviewedImportRow = { section:string; source:string; sourceRow:number; material:string; supplier:string; quantity:number; totalCostUgx:number; notes:string; category:"edible"|"non_edible"; unit:string; materialDecision:"existing"|"add"; supplierDecision:"existing"|"add"; };

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
  const eventDate = text(formData, "event_date");
  let untrustedRows: unknown;
  try { untrustedRows = JSON.parse(text(formData, "rows")); } catch { redirect("/raw-materials?error=The import preview is invalid."); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || eventDate > getUgandaServiceDate() || !Array.isArray(untrustedRows) || untrustedRows.length === 0 || untrustedRows.length > 500) redirect("/raw-materials?error=Choose a valid event date and at least one reviewed row.");
  const rows: ReviewedImportRow[] = [];
  for (const candidate of untrustedRows) {
    if (!candidate || typeof candidate !== "object") redirect("/raw-materials?error=One reviewed row is invalid.");
    const value = candidate as Record<string, unknown>;
    const material = importText(value.material), supplier = importText(value.supplier), unit = importText(value.unit), category = importText(value.category);
    const quantity = Number(value.quantity), totalCostUgx = Number(value.totalCostUgx);
    const materialDecision = importText(value.materialDecision), supplierDecision = importText(value.supplierDecision);
    if (!material || !supplier || (materialDecision === "add" && !unit) || !["edible", "non_edible"].includes(category) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(totalCostUgx) || totalCostUgx <= 0 || !["existing", "add"].includes(materialDecision) || !["existing", "add"].includes(supplierDecision)) redirect("/raw-materials?error=Every confirmed row needs an item, supplier, positive quantity, stock unit for a new item, and whole UGX amount.");
    rows.push({ section: importText(value.section), source: importText(value.source), sourceRow: Number(value.sourceRow), material, supplier, quantity, totalCostUgx, notes: importText(value.notes), category: category as "edible"|"non_edible", unit, materialDecision: materialDecision as "existing"|"add", supplierDecision: supplierDecision as "existing"|"add" });
  }
  const db = createAdminSupabaseClient();
  const [materialResult, supplierResult] = await Promise.all([db.from("raw_materials").select("id,name,is_active"), db.from("suppliers").select("id,name,is_active")]);
  if (materialResult.error || supplierResult.error) redirect("/raw-materials?error=Unable to validate the current material and supplier catalogue.");
  const materials = new Map((materialResult.data ?? []).map((item) => [normalizedName(item.name), item]));
  const suppliers = new Map((supplierResult.data ?? []).map((item) => [normalizedName(item.name), item]));
  const newMaterials = new Map<string, { name:string; category:"edible"|"non_edible"; unit_name:string }>();
  const newSuppliers = new Map<string, { name:string; supplier_type:"ingredient"|"supply"|"mixed" }>();
  for (const row of rows) {
    const existingMaterial = materials.get(normalizedName(row.material));
    if (existingMaterial && !existingMaterial.is_active) redirect("/raw-materials?error=An imported material is inactive. Reactivate it or disregard that row.");
    if (!existingMaterial) {
      if (row.materialDecision !== "add") redirect("/raw-materials?error=New materials must be explicitly added or disregarded.");
      const key = normalizedName(row.material), previous = newMaterials.get(key);
      if (previous && (previous.category !== row.category || normalizedName(previous.unit_name) !== normalizedName(row.unit))) redirect("/raw-materials?error=The same new material has conflicting categories or units.");
      newMaterials.set(key, { name: row.material, category: row.category, unit_name: row.unit });
    }
    const existingSupplier = suppliers.get(normalizedName(row.supplier));
    if (existingSupplier && !existingSupplier.is_active) redirect("/raw-materials?error=An imported supplier is inactive. Reactivate it or disregard that row.");
    if (!existingSupplier) {
      if (row.supplierDecision !== "add") redirect("/raw-materials?error=New suppliers must be explicitly added or disregarded.");
      const key = normalizedName(row.supplier), type = row.category === "edible" ? "ingredient" : "supply", previous = newSuppliers.get(key);
      newSuppliers.set(key, { name: row.supplier, supplier_type: previous && previous.supplier_type !== type ? "mixed" : type });
    }
  }
  if (newMaterials.size) {
    const { error } = await db.from("raw_materials").insert(Array.from(newMaterials.values()));
    if (error) redirect("/raw-materials?error=" + encodeURIComponent("Unable to add reviewed material: " + error.message));
  }
  if (newSuppliers.size) {
    const { error } = await db.from("suppliers").insert(Array.from(newSuppliers.values()));
    if (error) redirect("/raw-materials?error=" + encodeURIComponent("Unable to add reviewed supplier: " + error.message));
  }
  const canonicalRows = rows.map((row) => ({ material: row.material, quantity: row.quantity, supplier: row.supplier, totalCostUgx: row.totalCostUgx, receivedDate: eventDate, notes: row.notes || ("Imported from " + row.source + ", row " + row.sourceRow) }));
  const importHash = createHash("sha256").update(JSON.stringify({ eventDate, rows: canonicalRows })).digest("hex");
  const { error } = await db.rpc("record_raw_material_import", { p_batch_number: "RM-IMP-" + importHash.slice(0, 16), p_import_hash: importHash, p_filename: text(formData, "filename") || "raw-materials.xlsx", p_rows: canonicalRows, p_imported_by: actor.userId });
  if (!error) revalidatePath("/suppliers");
  if (error) redirect(`/raw-materials?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/raw-materials");
  revalidatePath("/reports");
  redirect("/raw-materials");
}
