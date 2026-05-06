import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { getOrderListItemsByIds } from "@/lib/ops/queries";

const reconcileOrdersSchema = z.object({
  orderIds: z.array(z.coerce.number().int().positive()).min(1).max(50)
});

export async function POST(request: Request) {
  try {
    await requireApprovedAdminRole();

    const body = await request.json().catch(() => null);
    const parsed = reconcileOrdersSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid reconcile request." },
        { status: 400 }
      );
    }

    const orders = await getOrderListItemsByIds(parsed.data.orderIds);
    return NextResponse.json({ ok: true, data: { orders } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconcile orders.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
