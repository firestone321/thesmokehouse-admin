import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, assertSameOriginRequest, requirePosAccess } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { preparePosReceiptHardware } from "@/lib/pos/receipt-hardware";
import { parseObject, RequestValidationError } from "@/lib/validation/http";

const schema = z.object({
  idempotencyKey: z.string().uuid(),
  orderMode: z.enum(["combined", "individual"]),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().min(1).max(30),
  busReference: z.string().trim().max(120).optional(),
  tenderType: z.enum(["cash", "mobile_money", "card"]),
  amountReceived: z.number().int().nonnegative(),
  paymentReference: z.string().trim().regex(/^(?:\d{4}|\d{11})$/).optional(),
  items: z.array(z.object({ menuItemId: z.number().int().positive(), quantity: z.number().int().min(1).max(200) })).min(1).max(7)
}).superRefine((value, context) => {
  if (value.orderMode === "combined" && !value.busReference) {
    context.addIssue({ code: "custom", path: ["busReference"], message: "Enter the bus reference for a combined sale." });
  }
});

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const actor = await requirePosAccess();
    const body = parseObject(await request.json(), schema);
    const requestHash = createHash("sha256").update(JSON.stringify({
      ...body,
      items: [...body.items].sort((a, b) => a.menuItemId - b.menuItemId)
    })).digest("hex");
    const { data, error } = await createAdminSupabaseClient().rpc("create_pos_traveller_counter_sale", {
      p_idempotency_key: body.idempotencyKey,
      p_request_hash: requestHash,
      p_cashier_profile_id: actor.userId,
      p_order_mode: body.orderMode,
      p_customer_name: body.customerName,
      p_customer_phone: body.customerPhone,
      p_bus_reference: body.busReference || null,
      p_tender_type: body.tenderType,
      p_amount_received: body.amountReceived,
      p_payment_reference: body.paymentReference || null,
      p_items: body.items.map((item) => ({ menu_item_id: item.menuItemId, quantity: item.quantity }))
    });
    if (error) throw new Error(error.message);
    const row = data?.[0];
    if (!row) throw new Error("The traveller counter sale did not return an order number.");
    const hardware = await preparePosReceiptHardware(Number(row.id), String(row.tender_type));
    return NextResponse.json({ ok: true, data: {
      orderId: Number(row.id), orderNumber: String(row.order_number),
      status: String(row.status), paymentStatus: String(row.payment_status),
      totalAmount: Number(row.total_amount), tenderType: String(row.tender_type),
      amountReceived: Number(row.amount_received), changeGiven: Number(row.change_given), hardware
    } });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to record traveller counter sale.";
    return NextResponse.json({ ok: false, message }, { status: error instanceof AdminAuthorizationError ? error.status : 500 });
  }
}
