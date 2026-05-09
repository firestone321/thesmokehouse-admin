import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, assertSameOriginRequest, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { getOrderListItemsByIds } from "@/lib/ops/queries";
import { RequestBodyTooLargeError } from "@/lib/request-limits";
import { RequestValidationError, parseJsonBody } from "@/lib/validation/http";

const reconcileOrdersSchema = z.object({
  orderIds: z.array(z.coerce.number().int().positive()).min(1).max(50)
});

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    await requireApprovedAdminRole();

    const body = await parseJsonBody(request, reconcileOrdersSchema, { maxBytes: 8 * 1024 });
    const orders = await getOrderListItemsByIds(body.orderIds);
    return NextResponse.json({ ok: true, data: { orders } });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ ok: false, message: "Reconcile payload is too large." }, { status: 413 });
    }

    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to reconcile orders.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
