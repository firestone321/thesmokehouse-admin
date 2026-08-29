import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import type { RawMaterialsPageData } from "./types";
export async function getRawMaterialsPageData(): Promise<RawMaterialsPageData> {
  const db = createAdminSupabaseClient();
  const [materials, suppliers, purchases] = await Promise.all([
    db.from("raw_materials").select("id,name,category,unit_name,current_quantity,reorder_threshold,is_active").order("category").order("name"),
    db.from("suppliers").select("id,name").eq("is_active", true).order("name"),
    db.from("raw_material_purchases").select("id,material_name_snapshot,category_snapshot,unit_snapshot,quantity,supplier_name_snapshot,total_cost_ugx,received_date,notes,source,created_by,created_at,raw_material_import_batches(batch_number)").order("received_date", { ascending: false }).order("created_at", { ascending: false }).limit(100)
  ]);
  if (materials.error) throw new Error(`Unable to load Raw Materials: ${materials.error.message}`);
  if (suppliers.error) throw new Error(`Unable to load suppliers: ${suppliers.error.message}`);
  if (purchases.error) throw new Error(`Unable to load Raw Material history: ${purchases.error.message}`);
  return {
    materials: (materials.data ?? []).map((row) => ({ id:Number(row.id), name:row.name, category:row.category, unitName:row.unit_name, currentQuantity:Number(row.current_quantity), reorderThreshold:Number(row.reorder_threshold), isActive:row.is_active })),
    suppliers: (suppliers.data ?? []).map((row) => ({ id:Number(row.id), name:row.name })),
    purchases: (purchases.data ?? []).map((row: any) => ({ id:Number(row.id), materialName:row.material_name_snapshot, category:row.category_snapshot, quantity:Number(row.quantity), unitName:row.unit_snapshot, supplierName:row.supplier_name_snapshot, totalCostUgx:Number(row.total_cost_ugx), receivedDate:row.received_date, notes:row.notes, source:row.source, importBatchNumber:row.raw_material_import_batches?.batch_number ?? null, createdBy:row.created_by, createdAt:row.created_at }))
  };
}
