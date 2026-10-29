import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, assertSameOriginRequest, requirePosAccess } from "@/lib/auth/admin-role";
import { findCashierSale } from "@/lib/pos/sale-server";
import { issueWalkInHardwareAction } from "@/lib/pos/hardware-bridge";
import { parseJsonBody, RequestValidationError } from "@/lib/validation/http";
import { posTimer } from "@/lib/pos/timing";
type Context = { params: Promise<{ idempotencyKey: string }> };
const schema = z.object({ kind: z.enum(["drawer", "receipt"]), requestId: z.union([z.literal("original"), z.string().uuid()]) }).strict()
  .refine((v) => v.kind !== "drawer" || v.requestId === "original");
export async function POST(request: Request, context: Context) {
  try {
    assertSameOriginRequest(request);
    const key = z.string().uuid().parse((await context.params).idempotencyKey);
    const tick = posTimer(key);
    const actor = await requirePosAccess(tick);
    const body = await parseJsonBody(request, schema, { maxBytes: 2048 });
    const receipt = await findCashierSale(key, actor.userId);
    if (!receipt || receipt.tenderType !== "cash") return NextResponse.json({ ok: false, message: "A committed cash sale owned by this cashier is required." }, { status: 403 });
    const data = await issueWalkInHardwareAction(receipt.orderId, receipt.canonicalReceipt, body.kind, body.requestId);
    if (!data) return NextResponse.json({ ok: false, message: "Local POS hardware is not enabled." }, { status: 503 });
    tick("hardware_authorization_prepared");
    console.info(JSON.stringify({ event: "admin_pos_hardware_authorized", correlationId: key, actionId: data.actionId }));
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, message: "Unable to authorize this hardware action. Sale remains recorded." },
      { status: error instanceof AdminAuthorizationError ? error.status : error instanceof RequestValidationError || error instanceof z.ZodError ? 400 : 503,
        headers: { "Cache-Control": "no-store" } });
  }
}
