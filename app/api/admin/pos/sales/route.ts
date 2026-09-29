import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { AdminAuthorizationError, assertSameOriginRequest, requirePosAccess } from "@/lib/auth/admin-role";
import { isPosHardwareBridgeEnabled, issuePosHardwareInstructions, type CanonicalPosReceipt } from "@/lib/pos/hardware-bridge";
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

async function loadCanonicalPosReceipt(orderId: number, cashierProfileId: string): Promise<CanonicalPosReceipt> {
  const { data, error } = await createAdminSupabaseClient()
    .from("orders")
    .select("order_number,paid_at,total_amount,order_items(menu_item_name,quantity,unit_price,line_total)")
    .eq("id", orderId)
    .eq("order_source", "pos")
    .eq("cashier_profile_id", cashierProfileId)
    .single();

  if (error || !data) throw new Error("Unable to load the committed POS receipt for the hardware bridge.");
  const { data: tenderData, error: tenderError } = await createAdminSupabaseClient()
    .from("pos_tenders")
    .select("tender_type")
    .eq("order_id", orderId)
    .single();

  if (tenderError || !tenderData) throw new Error("Unable to load the committed POS tender for the hardware bridge.");
  const tender = tenderData.tender_type;
  if (tender !== "cash" && tender !== "mobile_money" && tender !== "card") {
    throw new Error("Committed POS receipt has an unsupported tender type.");
  }

  const items = Array.isArray(data.order_items) ? data.order_items.map((item) => ({
    name: String(item.menu_item_name),
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
    total: Number(item.line_total)
  })) : [];
  if (items.length === 0) throw new Error("Committed POS receipt has no line items.");

  return {
    saleId: String(data.order_number),
    date: data.paid_at ? String(data.paid_at) : new Date().toISOString(),
    items,
    subtotal: Number(data.total_amount),
    total: Number(data.total_amount),
    paymentMethod: tender
  };
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

    const committedTender = String(sale.tender_type);
    let hardware: Awaited<ReturnType<typeof issuePosHardwareInstructions>> | { status: "unavailable" | "external_terminal"; message: string } = null;
    if (committedTender === "mobile_money" || committedTender === "card") {
      hardware = {
        status: "external_terminal",
        message: "Visa POS terminal receipt applies. Local receipt printer and cash drawer were not triggered."
      };
    } else if (isPosHardwareBridgeEnabled()) {
      try {
        const receipt = await loadCanonicalPosReceipt(Number(sale.id), actor.userId);
        hardware = await issuePosHardwareInstructions(receipt);
      } catch (hardwareError) {
        console.error("POS hardware authorization preparation failed after a committed sale.", hardwareError);
        hardware = { status: "unavailable", message: "Sale complete. Hardware receipt authorization is unavailable." };
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        orderId: Number(sale.id),
        orderNumber: String(sale.order_number),
        status: String(sale.status),
        totalAmount: Number(sale.total_amount),
        tenderType: committedTender,
        amountReceived: Number(sale.amount_received),
        changeGiven: Number(sale.change_given),
        hardware
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
