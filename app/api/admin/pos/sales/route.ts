import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { AdminAuthorizationError, assertSameOriginRequest, requirePosAccess } from "@/lib/auth/admin-role";
import { posSaleRequestSchema } from "@/lib/schemas/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { RequestValidationError, parseObject } from "@/lib/validation/http";

function normalizeForHash(input: {
  tenderType: string;
  amountReceived: number;
  paymentReference?: string;
  items: Array<{ menuItemId: number; quantity: number }>;
}) {
  return JSON.stringify({
    tenderType: input.tenderType,
    amountReceived: input.amountReceived,
    paymentReference: input.paymentReference?.trim() || null,
    items: [...input.items].sort((left, right) => left.menuItemId - right.menuItemId)
  });
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const actor = await requirePosAccess();
    const body = parseObject(await request.json(), posSaleRequestSchema);
    const requestHash = createHash("sha256").update(normalizeForHash(body)).digest("hex");

    const { data, error } = await createAdminSupabaseClient().rpc("create_pos_sale", {
      p_idempotency_key: body.idempotencyKey,
      p_request_hash: requestHash,
      p_cashier_profile_id: actor.userId,
      p_tender_type: body.tenderType,
      p_amount_received: body.amountReceived,
      p_payment_reference: body.paymentReference?.trim() || null,
      p_items: body.items.map((item) => ({ menu_item_id: item.menuItemId, quantity: item.quantity }))
    });

    if (error) {
      throw new Error(error.message);
    }

    const sale = data?.[0];
    if (!sale) {
      throw new Error("The POS sale did not return a receipt.");
    }

    return NextResponse.json({
      ok: true,
      data: {
        orderId: Number(sale.id),
        orderNumber: String(sale.order_number),
        status: String(sale.status),
        totalAmount: Number(sale.total_amount),
        tenderType: String(sale.tender_type),
        amountReceived: Number(sale.amount_received),
        changeGiven: Number(sale.change_given)
      }
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to create the POS sale.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
