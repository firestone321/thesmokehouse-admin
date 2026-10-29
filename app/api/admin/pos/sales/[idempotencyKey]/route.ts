import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, requirePosAccess } from "@/lib/auth/admin-role";
import { findCashierSale } from "@/lib/pos/sale-server";
type Context = { params: Promise<{ idempotencyKey: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const actor = await requirePosAccess();
    const key = z.string().uuid().parse((await context.params).idempotencyKey);
    const receipt = await findCashierSale(key, actor.userId);
    return NextResponse.json({ ok: true, outcome: receipt ? "committed" : "not_found", data: receipt },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, message: "Unable to resolve the original sale. Sign in as its cashier or ask for staff review." },
      { status: error instanceof AdminAuthorizationError ? error.status : error instanceof z.ZodError ? 400 : 503,
        headers: { "Cache-Control": "no-store" } });
  }
}
