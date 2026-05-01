import { NextResponse } from "next/server";
import {
  extractBearerToken,
  InternalRequestAuthError,
  requireInternalRequestSigningSecret,
  verifyInternalRequestToken
} from "@/lib/internal-auth";
import { processAdminPushDispatchQueue } from "@/lib/push/admin-paid-order-notifications";

export const runtime = "nodejs";

const ADMIN_PAID_ORDER_PUSH_PURPOSE = "admin_paid_order_push_dispatch";

function parseOrderId(value: unknown) {
  const orderId = Number(value);
  return Number.isInteger(orderId) && orderId > 0 ? orderId : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const orderId = body && typeof body === "object" ? parseOrderId((body as { orderId?: unknown }).orderId) : null;
    if (!orderId) {
      return NextResponse.json(
        {
          message: "Invalid admin paid-order push request."
        },
        { status: 400 }
      );
    }

    const providedToken = extractBearerToken(request);
    if (!providedToken) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    verifyInternalRequestToken({
      token: providedToken,
      secret: requireInternalRequestSigningSecret("STOREFRONT_INTERNAL_AUTH_TOKEN"),
      issuer: "thesmokehouse-storefront",
      audience: "thesmokehouse-admin",
      purpose: ADMIN_PAID_ORDER_PUSH_PURPOSE,
      method: "POST",
      path: new URL(request.url).pathname,
      orderId: String(orderId)
    });

    const stats = await processAdminPushDispatchQueue({
      orderId,
      limit: 1
    });

    return NextResponse.json({ ok: true, stats });
  } catch (error) {
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
