import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { isPosHardwareBridgeEnabled } from "@/lib/pos/hardware-bridge";
import type { SaleReceipt } from "./sale-contract";
export function decorateReceipt(data: unknown): SaleReceipt {
  const receipt = data as SaleReceipt;
  if (!receipt?.orderId || !receipt.canonicalReceipt?.items?.length) throw new Error("Committed receipt is unavailable. Review the original sale.");
  return { ...receipt, hardwareEnabled: isPosHardwareBridgeEnabled() && receipt.tenderType === "cash" };
}
export async function findCashierSale(key: string, userId: string): Promise<SaleReceipt | null> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.from("pos_sale_requests").select("order_id")
    .eq("idempotency_key", key).eq("cashier_profile_id", userId).maybeSingle();
  if (error) throw new Error("Unable to check the original sale. No replacement was created.");
  if (!data?.order_id) return null;
  const result = await supabase.rpc("get_pos_sale_receipt", { p_order_id: data.order_id, p_cashier_profile_id: userId });
  if (result.error) throw new Error("Unable to restore the committed receipt.");
  return decorateReceipt(result.data);
}
