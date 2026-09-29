import Link from "next/link";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { TravellerBeefConversionForm } from "@/components/procurement/traveller-beef-conversion-form";

export default async function TravellerBeefConversionPage() {
  await requireApprovedAdminRole();
  const db = createAdminSupabaseClient();
  const { data: protein, error: proteinError } = await db.from("proteins").select("id").eq("code", "beef").single();
  if (proteinError || !protein) throw new Error(proteinError?.message ?? "Beef protein is not configured.");
  const { data: portions, error: portionError } = await db.from("portion_types")
    .select("id,name,code,finished_stock(current_quantity)").eq("protein_id", protein.id);
  if (portionError) throw new Error(portionError.message);
  const sourcePortions = (portions ?? []).map((row) => ({
    id: Number(row.id), name: String(row.name), code: String(row.code),
    pooledStock: Number((Array.isArray(row.finished_stock) ? row.finished_stock[0] : row.finished_stock)?.current_quantity ?? 0)
  }));
  const ids = sourcePortions.map((row) => row.id);
  const [batches, conversions] = ids.length ? await Promise.all([
    db.from("processing_batches")
      .select("id,portion_type_id,quantity_produced,created_at")
      .in("portion_type_id", ids).order("created_at", { ascending: false }).limit(100),
    db.from("traveller_beef_conversion_totals")
      .select("source_processing_batch_id,portions_converted")
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (batches.error) throw new Error(batches.error.message);
  if (conversions.error) throw new Error(conversions.error.message);
  const prior = new Map<number, number>();
  for (const row of conversions.data ?? []) {
    const id = Number(row.source_processing_batch_id);
    prior.set(id, Number(row.portions_converted));
  }
  const names = new Map(sourcePortions.map((row) => [row.id, row]));
  const options = (batches.data ?? []).map((row) => ({
    id: Number(row.id), sourceName: names.get(Number(row.portion_type_id))?.name ?? "Beef",
    quantityProduced: Number(row.quantity_produced),
    alreadyConverted: prior.get(Number(row.id)) ?? 0,
    pooledStock: names.get(Number(row.portion_type_id))?.pooledStock ?? 0,
    processedAt: String(row.created_at)
  }));
  return <div className="space-y-5">
    <Link href="/procurement" className="text-sm font-semibold underline">Back to procurement</Link>
    <TravellerBeefConversionForm batches={options} />
  </div>;
}