import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, assertSameOriginRequest, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { parseObject, RequestValidationError } from "@/lib/validation/http";

const schema = z.object({
  portionCode: z.enum(["traveller_salad", "traveller_sauce", "soda_bottle_330ml"]),
  sourceReference: z.string().trim().min(1).max(120),
  quantityCounted: z.number().int().min(1).max(10000),
  sourceUnitsConsumed: z.number().int().nonnegative().optional(),
  note: z.string().trim().max(500).optional()
});

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const actor = await requireApprovedAdminRole();
    const input = parseObject(await request.json(), schema);
    const { data, error } = await createAdminSupabaseClient().rpc("record_traveller_component_restock", {
      p_portion_code: input.portionCode,
      p_source_reference: input.sourceReference,
      p_quantity_counted: input.quantityCounted,
      p_actor_profile_id: actor.userId,
      p_source_units_consumed: input.sourceUnitsConsumed ?? null,
      p_note: input.note || null
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, restockId: Number(data) });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to record traveller restock.";
    return NextResponse.json({ ok: false, message }, { status: error instanceof AdminAuthorizationError ? error.status : 500 });
  }
}