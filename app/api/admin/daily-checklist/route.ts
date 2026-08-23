import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, assertSameOriginRequest, requireDashboardRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { getUgandaServiceDate, isDailyOperationsChecklistActive } from "@/lib/ops/utils";
import { DAILY_OPERATIONS_CHECKLIST_ITEMS, mapDailyOperationsChecklistRecord } from "@/lib/ops/daily-checklist";
import { getDailyOperationsChecklist } from "@/lib/ops/daily-checklist-data";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { RequestValidationError, parseJsonBody } from "@/lib/validation/http";

const checklistResponseSchema = z.object({
  status: z.enum(["ok", "issue"]),
  note: z.string().trim().max(1000).nullable().optional()
});

const checklistSubmissionSchema = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  responses: z.record(z.string(), checklistResponseSchema)
});

function responseForApi(row: any) {
  return mapDailyOperationsChecklistRecord(row);
}

export async function GET() {
  try {
    await requireDashboardRole();
    const active = isDailyOperationsChecklistActive();
    return NextResponse.json({
      ok: true,
      active,
      record: active ? await getDailyOperationsChecklist(getUgandaServiceDate()) : null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the daily checklist.";
    const status = error instanceof AdminAuthorizationError ? error.status : error instanceof OperationsSchemaMissingError ? 503 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const actor = await requireDashboardRole();
    const body = await parseJsonBody(request, checklistSubmissionSchema, { maxBytes: 48 * 1024 });

    if (!isDailyOperationsChecklistActive()) {
      return NextResponse.json({ ok: false, message: "The opening checklist becomes available at 6:00 AM EAT." }, { status: 409 });
    }

    if (body.serviceDate !== getUgandaServiceDate()) {
      return NextResponse.json({ ok: false, message: "This checklist is for a different service date. Refresh the dashboard." }, { status: 409 });
    }

    const expectedIds = new Set<string>(DAILY_OPERATIONS_CHECKLIST_ITEMS.map((item) => item.id));
    const submittedIds = Object.keys(body.responses);
    if (submittedIds.length !== expectedIds.size || submittedIds.some((id) => !expectedIds.has(id))) {
      return NextResponse.json({ ok: false, message: "Every checklist item must be answered before continuing." }, { status: 400 });
    }

    const responses = Object.fromEntries(
      DAILY_OPERATIONS_CHECKLIST_ITEMS.map((item) => {
        const response = body.responses[item.id];
        const note = response.note?.trim() || null;
        return [item.id, { status: response.status, note }];
      })
    );

    const missingIssueNote = DAILY_OPERATIONS_CHECKLIST_ITEMS.find(
      (item) => responses[item.id].status === "issue" && !responses[item.id].note
    );
    if (missingIssueNote) {
      return NextResponse.json({ ok: false, message: `Add a note for the issue recorded under ${missingIssueNote.label}.` }, { status: 400 });
    }

    const { data, error } = await createAdminSupabaseClient().rpc("complete_daily_operations_checklist", {
      p_service_date: body.serviceDate,
      p_submitted_by_profile_id: actor.userId,
      p_responses: responses
    });

    if (error || !data?.[0]) {
      throw new Error(error?.message || "The daily checklist could not be completed.");
    }

    return NextResponse.json({ ok: true, record: responseForApi(data[0]) });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to complete the daily checklist.";
    const status = error instanceof AdminAuthorizationError ? error.status : error instanceof OperationsSchemaMissingError ? 503 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
