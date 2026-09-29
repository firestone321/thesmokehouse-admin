import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { isPosHardwareBridgeEnabled, issuePosHardwareInstructions, type CanonicalPosReceipt } from "@/lib/pos/hardware-bridge";

export async function loadCanonicalPosReceipt(orderId: number): Promise<CanonicalPosReceipt> {
  const db = createAdminSupabaseClient();
  const { data, error } = await db.from("orders")
    .select("order_number,paid_at,total_amount,order_items(menu_item_name,quantity,unit_price,line_total)")
    .eq("id", orderId).eq("order_source", "pos").single();
  if (error || !data) throw new Error("Unable to load the committed POS receipt.");
  const { data: tender, error: tenderError } = await db.from("pos_tenders")
    .select("tender_type").eq("order_id", orderId).single();
  if (tenderError || !tender) throw new Error("Unable to load the committed POS tender.");
  if (tender.tender_type !== "cash" && tender.tender_type !== "mobile_money" && tender.tender_type !== "card") {
    throw new Error("Committed POS receipt has an unsupported tender type.");
  }
  const items = Array.isArray(data.order_items) ? data.order_items.map((item) => ({
    name: String(item.menu_item_name), quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price), total: Number(item.line_total)
  })) : [];
  if (items.length < 1) throw new Error("Committed POS receipt has no line items.");
  return { saleId: String(data.order_number), date: data.paid_at ? String(data.paid_at) : new Date().toISOString(),
    items, subtotal: Number(data.total_amount), total: Number(data.total_amount), paymentMethod: tender.tender_type };
}

export async function preparePosReceiptHardware(orderId: number, tenderType: string) {
  if (tenderType === "mobile_money" || tenderType === "card") {
    return { status: "external_terminal" as const,
      message: "Visa POS terminal receipt applies. Local receipt printer and cash drawer were not triggered." };
  }
  if (!isPosHardwareBridgeEnabled()) return null;
  try {
    return await issuePosHardwareInstructions(await loadCanonicalPosReceipt(orderId));
  } catch (error) {
    console.error("POS hardware authorization preparation failed after a committed sale.", error);
    return { status: "unavailable" as const,
      message: "Sale complete. Hardware receipt authorization is unavailable." };
  }
}