import { NextResponse } from "next/server";
import { AdminAuthorizationError, assertSameOriginRequest, requirePosAccess } from "@/lib/auth/admin-role";
import {
  onlineReceiptPrintJobResultSchema,
  onlineReceiptPrintJobRouteParamsSchema
} from "@/lib/schemas/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { RequestValidationError, parseJsonBody, parseObject } from "@/lib/validation/http";

type RouteContext = {
  params: Promise<{ printJobId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginRequest(request);
    await requirePosAccess();
    const { printJobId } = parseObject(await context.params, onlineReceiptPrintJobRouteParamsSchema);
    const body = await parseJsonBody(request, onlineReceiptPrintJobResultSchema, { maxBytes: 4 * 1024 });
    const now = new Date().toISOString();
    const values = body.status === "queued"
      ? {
          status: "accepted",
          completed_at: now,
          last_attempt_at: now,
          last_error: null,
          bridge_result: body.bridgeResult ?? { status: "queued" }
        }
      : {
          status: "pending",
          completed_at: null,
          last_attempt_at: now,
          last_error: body.error ?? "bridge_print_failed",
          bridge_result: body.bridgeResult ?? null
        };

    const { data, error } = await createAdminSupabaseClient()
      .from("online_receipt_print_jobs")
      .update(values)
      .eq("id", printJobId)
      .select("id,status,completed_at")
      .maybeSingle();
    if (error) throw new Error(`Unable to record receipt print result: ${error.message}`);
    if (!data) return NextResponse.json({ ok: false, message: "Receipt print job not found." }, { status: 404 });

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to record receipt print result.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
