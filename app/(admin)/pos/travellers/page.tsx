import Link from "next/link";
import { requirePosAccess } from "@/lib/auth/admin-role";
import { getPosMenuItems } from "@/lib/pos/queries";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { TravellerPreorderWorkspace } from "@/components/pos/traveller-preorder-workspace";

export default async function TravellerPreordersPage() {
  await requirePosAccess();
  const db = createAdminSupabaseClient();
  const [menuItems, preorderResponse, drinkResponse] = await Promise.all([
    getPosMenuItems({ includeUnavailable: true }),
    db.from("pos_traveller_preorders")
      .select("order_id,order_mode,payment_timing,bus_reference,checked_in_at")
      .order("order_id", { ascending: false })
      .limit(200),
    db.from("menu_items").select("id,code").in("code", ["juice", "bottled_mineral_water", "soda"])
  ]);
  if (preorderResponse.error) throw new Error(`Unable to load traveller preorders: ${preorderResponse.error.message}`);
  if (drinkResponse.error) throw new Error(`Unable to load regular drinks: ${drinkResponse.error.message}`);
  const drinkIds = new Set((drinkResponse.data ?? []).map((item) => Number(item.id)));
  const preorders = preorderResponse.data ?? [];
  const orderIds = preorders.map((row) => Number(row.order_id));
  const ordersResponse = orderIds.length
    ? await db.from("orders")
      .select("id,order_number,customer_name,customer_phone,status,payment_status,total_amount,promised_at,order_items(menu_item_name,quantity,unit_price)")
      .in("id", orderIds)
    : { data: [], error: null };
  if (ordersResponse.error) throw new Error(`Unable to load traveller orders: ${ordersResponse.error.message}`);
  const ordersById = new Map((ordersResponse.data ?? []).map((row) => [Number(row.id), row]));
  const activePreorders = preorders.flatMap((preorder) => {
    const order = ordersById.get(Number(preorder.order_id));
    if (!order || !["new", "confirmed", "in_prep"].includes(String(order.status))) return [];
    return [{
      orderId: Number(order.id),
      orderNumber: String(order.order_number),
      customerName: String(order.customer_name ?? ""),
      customerPhone: String(order.customer_phone ?? ""),
      status: String(order.status),
      paymentStatus: String(order.payment_status),
      totalAmount: Number(order.total_amount),
      promisedAt: String(order.promised_at),
      orderMode: String(preorder.order_mode),
      paymentTiming: String(preorder.payment_timing),
      busReference: preorder.bus_reference ? String(preorder.bus_reference) : null,
      checkedInAt: preorder.checked_in_at ? String(preorder.checked_in_at) : null,
      items: (Array.isArray(order.order_items) ? order.order_items : []).map((item) => ({
        name: String(item.menu_item_name), quantity: Number(item.quantity), unitPrice: Number(item.unit_price)
      }))
    }];
  });

  return (
    <div className="space-y-4">
      <Link href="/pos" className="inline-flex rounded-xl border border-[#D7DDE4] bg-white px-4 py-2 text-sm font-semibold">Back to counter POS</Link>
      <TravellerPreorderWorkspace
        foodItems={menuItems.filter((item) => item.categoryName === "Travellers")}
        drinkItems={menuItems.filter((item) => drinkIds.has(item.id))}
        preorders={activePreorders}
      />
    </div>
  );
}
