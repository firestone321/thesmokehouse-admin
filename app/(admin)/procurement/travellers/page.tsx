import Link from "next/link";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { TravellerComponentRestockForm } from "@/components/procurement/traveller-component-restock-form";

const codes = ["traveller_salad", "traveller_sauce", "soda_bottle_330ml"];

export default async function TravellerRestockPage() {
  await requireApprovedAdminRole();
  const db = createAdminSupabaseClient();
  const [portions, recent] = await Promise.all([
    db.from("portion_types").select("id,code,name,portion_label,finished_stock(current_quantity)").in("code", codes),
    db.from("traveller_component_restocks")
      .select("id,source_reference,quantity_counted,recorded_at,portion_types(name)")
      .order("recorded_at", { ascending: false }).limit(20)
  ]);
  if (portions.error) throw new Error(portions.error.message);
  if (recent.error) throw new Error(recent.error.message);
  const options = (portions.data ?? []).map((row) => ({
    code: String(row.code), name: String(row.name), label: String(row.portion_label),
    stock: Number((Array.isArray(row.finished_stock) ? row.finished_stock[0] : row.finished_stock)?.current_quantity ?? 0)
  }));
  const history = (recent.data ?? []).map((row) => ({
    id: Number(row.id), sourceReference: String(row.source_reference),
    quantity: Number(row.quantity_counted), recordedAt: String(row.recorded_at),
    name: String((Array.isArray(row.portion_types) ? row.portion_types[0] : row.portion_types)?.name ?? "")
  }));
  return <div className="space-y-5">
    <Link href="/procurement" className="text-sm font-semibold underline">Back to procurement</Link>
    <TravellerComponentRestockForm options={options} history={history} />
  </div>;
}