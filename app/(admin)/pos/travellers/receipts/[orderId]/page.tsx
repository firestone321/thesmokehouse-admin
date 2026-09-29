import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePosAccess } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { PrintReceiptButton } from "@/components/pos/print-receipt-button";

type Props = { params: Promise<{ orderId: string }> };
const money = (value: number) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(value);

export default async function TravellerReceiptPage({ params }: Props) {
  await requirePosAccess();
  const id = Number((await params).orderId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const db = createAdminSupabaseClient();
  const { data: preorder, error: preorderError } = await db.from("pos_traveller_preorders")
    .select("order_id,order_mode,bus_reference").eq("order_id", id).maybeSingle();
  if (preorderError) throw new Error(preorderError.message);
  if (!preorder) notFound();
  const [orderResult, tenderResult] = await Promise.all([
    db.from("orders")
      .select("order_number,customer_name,customer_phone,status,payment_status,paid_at,promised_at,total_amount,order_items(menu_item_name,quantity,unit_price,line_total)")
      .eq("id", id).eq("order_source", "pos").single(),
    db.from("pos_tenders").select("tender_type,amount_received,change_given").eq("order_id", id).maybeSingle()
  ]);
  if (orderResult.error || !orderResult.data) notFound();
  if (tenderResult.error) throw new Error(tenderResult.error.message);
  const order = orderResult.data;
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  return <main className="mx-auto max-w-md space-y-4 bg-white p-6 text-[#111418] print:m-0 print:max-w-none print:p-0">
    <div className="flex items-center justify-between print:hidden">
      <Link href="/pos/travellers" className="text-sm font-semibold underline">Back to traveller POS</Link>
      <PrintReceiptButton />
    </div>
    <div className="text-center"><h1 className="text-xl font-bold">Firestone Smokehouse</h1><p className="text-sm">Traveller order receipt</p></div>
    <div className="border-y py-3 text-sm">
      <p><strong>Order:</strong> {order.order_number}</p>
      <p><strong>Customer:</strong> {order.customer_name}</p>
      <p><strong>Phone:</strong> {order.customer_phone}</p>
      <p><strong>Type:</strong> {preorder.order_mode === "combined" ? "Combined bus order" : "Passenger order"}</p>
      {preorder.bus_reference ? <p><strong>Bus:</strong> {preorder.bus_reference}</p> : null}
      <p><strong>Arrival:</strong> {new Date(String(order.promised_at)).toLocaleString("en-UG", { timeZone: "Africa/Kampala" })}</p>
      <p><strong>Status:</strong> {String(order.status).replaceAll("_", " ")}</p>
    </div>
    <ul className="space-y-2 text-sm">{items.map((item, index) => <li key={index} className="flex justify-between gap-4"><span>{item.quantity} × {item.menu_item_name}</span><span>{money(Number(item.line_total))}</span></li>)}</ul>
    <div className="border-t pt-3 text-sm"><p className="flex justify-between text-base font-bold"><span>Total</span><span>{money(Number(order.total_amount))}</span></p>
      <p className="mt-2"><strong>Payment:</strong> {order.payment_status === "paid" ? `Paid by ${String(tenderResult.data?.tender_type ?? "POS").replaceAll("_", " ")}` : "Due on arrival"}</p>
      {tenderResult.data ? <><p>Received: {money(Number(tenderResult.data.amount_received))}</p><p>Change: {money(Number(tenderResult.data.change_given))}</p></> : null}
    </div>
    <p className="text-center text-xs text-[#5F6670]">Thank you for travelling with us.</p>
  </main>;
}