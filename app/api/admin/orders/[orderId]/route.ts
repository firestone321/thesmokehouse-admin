import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { orderRouteParamsSchema } from "@/lib/schemas/admin";
import { getOrderListItemById } from "@/lib/ops/queries";
import { RequestValidationError, parseObject } from "@/lib/validation/http";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireApprovedAdminRole();

    const { orderId } = parseObject(await context.params, orderRouteParamsSchema);
    const order = await getOrderListItemById(orderId);

    if (!order) {
      return NextResponse.json({ ok: false, message: "Order not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: { order } });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to load order.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
