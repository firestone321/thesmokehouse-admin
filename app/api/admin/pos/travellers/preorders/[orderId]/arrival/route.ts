import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, assertSameOriginRequest, requirePosAccess } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { preparePosReceiptHardware } from "@/lib/pos/receipt-hardware";
import { parseObject, RequestValidationError } from "@/lib/validation/http";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check_in") }),
  z.object({
    action: z.literal("pay"),
    tenderType: z.enum(["cash", "mobile_money", "card"]),
    amountReceived: z.number().int().nonnegative(),
    paymentReference: z.string().trim().regex(/^(?:\d{4}|\d{11})$/).optional()
  })
]);

type RouteContext = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginRequest(request);
    const actor = await requirePosAccess();
    const { orderId } = await context.params;
    const id = Number(orderId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new RequestValidationError("Invalid preorder number.");
    const body = parseObject(await request.json(), schema);
    const supabase = createAdminSupabaseClient();
    if (body.action === "check_in") {
      const { data, error } = await supabase.rpc("check_in_paid_pos_traveller_preorder", {
        p_order_id: id,
        p_staff_profile_id: actor.userId
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, data: {
        orderId: Number(data.id), orderNumber: String(data.order_number),
        status: String(data.status), paymentStatus: String(data.payment_status)
      } });
    }
    const { data, error } = await supabase.rpc("pay_pos_traveller_preorder", {
      p_order_id: id,
      p_cashier_profile_id: actor.userId,
      p_tender_type: body.tenderType,
      p_amount_received: body.amountReceived,
      p_payment_reference: body.paymentReference || null
    });
    if (error) throw new Error(error.message);
    const row = data?.[0];
    if (!row) throw new Error("The arrival payment did not return a receipt.");
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
    const message = error instanceof Error ? error.message : "Unable to check in traveller preorder.";
    return NextResponse.json({ ok: false, message }, { status: error instanceof AdminAuthorizationError ? error.status : 500 });
  }
}
