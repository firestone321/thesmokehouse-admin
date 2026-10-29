import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AdminAuthorizationError, assertSameOriginRequest, requirePosAccess } from "@/lib/auth/admin-role";
import { posSaleRequestSchema } from "@/lib/schemas/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { RequestValidationError, parseJsonBody } from "@/lib/validation/http";
import { RequestBodyTooLargeError } from "@/lib/request-limits";
import { hashableSale } from "@/lib/pos/sale-contract";
import { decorateReceipt } from "@/lib/pos/sale-server";
import { posTimer } from "@/lib/pos/timing";
import { issueWalkInHardwareAction } from "@/lib/pos/hardware-bridge";

export async function POST(request: Request) {
  let correlationId = randomUUID() as string;
  let rpcStarted = false;
  try {
    assertSameOriginRequest(request);
    const body = await parseJsonBody(request, posSaleRequestSchema, { maxBytes: 32_768 });
    correlationId = body.idempotencyKey;
    const tick = posTimer(correlationId);
    const actor = await requirePosAccess(tick);
    const requestHash = createHash("sha256").update(hashableSale(body)).digest("hex");
    rpcStarted = true;
    const { data, error } = await createAdminSupabaseClient().rpc("create_pos_sale_with_receipt", {
      p_idempotency_key: body.idempotencyKey, p_request_hash: requestHash, p_cashier_profile_id: actor.userId,
      p_tender_type: body.tenderType, p_amount_received: body.amountReceived,
      p_payment_reference: body.paymentReference?.trim() || null,
      p_items: body.items.map((item) => ({ menu_item_id: item.menuItemId, quantity: item.quantity }))
    });
    if (error) {
      tick("sale_rpc_completed", "failed");
      // Only database rollback responses are definitive. Transport loss is not.
      const rolledBack = error.code?.startsWith("23") || (error.code === "P0001" && /^(?:invalid_pos_|pos_item_unavailable|insufficient_cash_received|non_cash_tender_requires|Insufficient finished stock|Insufficient service-day stock)/.test(error.message));
      return NextResponse.json({ ok: false, outcome: rolledBack ? "rejected" : "outcome_unknown",
        message: rolledBack ? "Sale rejected by stock or payment validation. Check the original outcome before starting a different sale."
          : "Sale outcome unknown. Check the original request; do not create a replacement.",
        correlationId }, { status: rolledBack ? 409 : 503, headers: { "Cache-Control": "no-store" } });
    }
    tick("sale_rpc_completed");
    const receipt = decorateReceipt(data);
    tick("receipt_data_prepared");
    // Initial grants avoid another cloud round trip before local dispatch.
    // They are response-only; the browser never persists bearer tokens.
    let hardware = null;
    if (receipt.tenderType === "cash" && receipt.hardwareEnabled) {
      try {
        const [drawer, print] = await Promise.all([
          issueWalkInHardwareAction(receipt.orderId, receipt.canonicalReceipt, "drawer", "original"),
          issueWalkInHardwareAction(receipt.orderId, receipt.canonicalReceipt, "receipt", "original")
        ]);
        hardware = { drawer, receipt: print };
        tick("hardware_authorization_prepared");
        console.info(JSON.stringify({ event: "admin_pos_hardware_authorized", correlationId,
          actionIds: [drawer?.actionId, print?.actionId] }));
      } catch {
        // The sale already committed. Authorization failure cannot turn it into a failed sale.
        tick("hardware_authorization_prepared", "failed");
      }
    }
    tick("api_response_prepared");
    return NextResponse.json({ ok: true, data: receipt, hardware, correlationId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = error instanceof RequestValidationError || error instanceof RequestBodyTooLargeError;
    const status = error instanceof AdminAuthorizationError ? error.status : invalid ? 400 : 503;
    console.warn(JSON.stringify({ event: "admin_pos_request_failed", correlationId, rpcStarted, status }));
    return NextResponse.json({ ok: false, outcome: invalid && !rpcStarted ? "rejected" : "outcome_unknown",
      message: invalid ? "Invalid sale request. Review the original payload." :
        status === 401 || status === 403 ? "Sign in as the original cashier to check this sale." : "Sale outcome unknown. Check the original request.",
      correlationId }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
