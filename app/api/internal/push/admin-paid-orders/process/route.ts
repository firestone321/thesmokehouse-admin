import { NextResponse } from "next/server";
import {
  extractBearerToken,
  InternalRequestAuthError,
  requireInternalRequestSigningSecret,
  verifyInternalRequestToken
} from "@/lib/internal-auth";
import { processAdminPushDispatchQueue } from "@/lib/push/admin-paid-order-notifications";
import { adminPaidOrderPushProcessSchema } from "@/lib/schemas/admin";
import { RequestValidationError, parseJsonBody } from "@/lib/validation/http";

export const runtime = "nodejs";

const ADMIN_PAID_ORDER_PUSH_PURPOSE = "admin_paid_order_push_dispatch";

export async function POST(request: Request) {
  try {
    const providedToken = extractBearerToken(request);
    if (!providedToken) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const body = await parseJsonBody(request, adminPaidOrderPushProcessSchema);

    verifyInternalRequestToken({
      token: providedToken,
      secret: requireInternalRequestSigningSecret("STOREFRONT_INTERNAL_AUTH_TOKEN"),
      issuer: "thesmokehouse-storefront",
      audience: "thesmokehouse-admin",
      purpose: ADMIN_PAID_ORDER_PUSH_PURPOSE,
      method: "POST",
      path: new URL(request.url).pathname,
      orderId: String(body.orderId)
    });

    const stats = await processAdminPushDispatchQueue({
      orderId: body.orderId,
      limit: 1
    });

    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ message: error.message, issues: error.issues }, { status: 400 });
    }

    if (error instanceof InternalRequestAuthError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Unable to process admin paid-order push."
      },
      { status: 500 }
    );
  }
}
