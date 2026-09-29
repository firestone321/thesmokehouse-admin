import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, assertSameOriginRequest, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { parseObject, RequestValidationError } from "@/lib/validation/http";

const schema = z.object({
  sourceProcessingBatchId: z.number().int().positive(),
  sourcePortionsUsed: z.number().int().min(1).max(10000),
  skewersProduced: z.number().int().min(0).max(10000),
  samosasProduced: z.number().int().min(0).max(10000),
  cookedOn: z.iso.date(),
  earlyConversionAcknowledged: z.boolean(),
  batchReference: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500).optional()
}).refine((value) => value.skewersProduced + value.samosasProduced > 0, {
  message: "Enter at least one finished skewer or samosa."
});

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const actor = await requireApprovedAdminRole();
    const input = parseObject(await request.json(), schema);
    const { data, error } = await createAdminSupabaseClient().rpc("convert_cooked_beef_to_traveller_pieces", {
      p_source_processing_batch_id: input.sourceProcessingBatchId,
      p_source_portions_used: input.sourcePortionsUsed,
      p_skewers_produced: input.skewersProduced,
      p_samosas_produced: input.samosasProduced,
      p_cooked_on: input.cookedOn,
      p_early_conversion_acknowledged: input.earlyConversionAcknowledged,
      p_batch_reference: input.batchReference,
      p_actor_profile_id: actor.userId,
      p_note: input.note || null
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, conversionId: Number(data) });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to convert beef stock.";
    return NextResponse.json({ ok: false, message }, { status: error instanceof AdminAuthorizationError ? error.status : 500 });
  }
}