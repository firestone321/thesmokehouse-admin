import { NextResponse } from "next/server";
import { AdminAuthorizationError, assertSameOriginRequest, requirePosAccess } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { RequestValidationError } from "@/lib/validation/http";

type RouteContext = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginRequest(request);
    const actor = await requirePosAccess();
    const { orderId } = await context.params;
    const id = Number(orderId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new RequestValidationError("Invalid preorder number.");
    const { data, error } = await createAdminSupabaseClient().rpc("cancel_unpaid_pos_traveller_preorder", {
      p_order_id: id, p_staff_profile_id: actor.userId
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, data: { orderId: Number(data.id), status: String(data.status) } });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to cancel traveller preorder.";
    return NextResponse.json({ ok: false, message }, { status: error instanceof AdminAuthorizationError ? error.status : 500 });
  }
}