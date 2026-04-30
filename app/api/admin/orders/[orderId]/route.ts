import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { getOrderListItemById } from "@/lib/ops/queries";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireApprovedAdminRole();

    const { orderId } = await context.params;
    const order = await getOrderListItemById(orderId);

    if (!order) {
      return NextResponse.json({ ok: false, message: "Order not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: { order } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load order.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
