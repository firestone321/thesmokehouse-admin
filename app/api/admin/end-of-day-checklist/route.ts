import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, assertSameOriginRequest, requireDashboardRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { getUgandaServiceDate, getUgandaServiceDateOffset, isDailyOperationsChecklistActive, isEndOfDayChecklistActive } from "@/lib/ops/utils";
import { END_OF_DAY_CHECKLIST_ITEMS, mapEndOfDayChecklistRecord } from "@/lib/ops/end-of-day-checklist";
import { getEndOfDayChecklist } from "@/lib/ops/end-of-day-checklist-data";
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

export async function GET() {
  try {
    await requireDashboardRole();
    const currentServiceDate = getUgandaServiceDate();
    const previousServiceDate = getUgandaServiceDateOffset(-1);
    const openingActive = isDailyOperationsChecklistActive();
    const closingActive = isEndOfDayChecklistActive();
    const previousRecord = openingActive ? await getEndOfDayChecklist(previousServiceDate) : null;
    const currentRecord = closingActive ? await getEndOfDayChecklist(currentServiceDate) : null;
    const serviceDate = openingActive && !previousRecord
      ? previousServiceDate
      : currentServiceDate;
    const active = Boolean((openingActive && !previousRecord) || closingActive);
    return NextResponse.json({
      ok: true,
      active,
      serviceDate,
      record: serviceDate === previousServiceDate && openingActive && !previousRecord ? null : currentRecord
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the end-of-day checklist.";
    const status = error instanceof AdminAuthorizationError ? error.status : error instanceof OperationsSchemaMissingError ? 503 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const actor = await requireDashboardRole();
    const body = await parseJsonBody(request, checklistSubmissionSchema, { maxBytes: 64 * 1024 });

    const currentServiceDate = getUgandaServiceDate();
    const previousServiceDate = getUgandaServiceDateOffset(-1);
    const isPreviousClose = body.serviceDate === previousServiceDate;
    if (body.serviceDate !== currentServiceDate && !isPreviousClose) {
      return NextResponse.json({ ok: false, message: "This checklist is for a different service date. Refresh the admin." }, { status: 409 });
    }

    if (!isPreviousClose && !isEndOfDayChecklistActive()) {
      return NextResponse.json({ ok: false, message: "The end-of-day checklist becomes available at 8:30 PM EAT." }, { status: 409 });
    }

    const expectedIds = new Set<string>(END_OF_DAY_CHECKLIST_ITEMS.map((item) => item.id));
    const submittedIds = Object.keys(body.responses);
    if (submittedIds.length !== expectedIds.size || submittedIds.some((id) => !expectedIds.has(id))) {
      return NextResponse.json({ ok: false, message: "Every end-of-day checklist item must be answered before continuing." }, { status: 400 });
    }

    const responses = Object.fromEntries(
      END_OF_DAY_CHECKLIST_ITEMS.map((item) => {
        const response = body.responses[item.id];
        const note = response.note?.trim() || null;
        return [item.id, { status: response.status, note }];
      })
    );

    const missingIssueNote = END_OF_DAY_CHECKLIST_ITEMS.find(
      (item) => responses[item.id].status === "issue" && !responses[item.id].note
    );
    if (missingIssueNote) {
      return NextResponse.json({ ok: false, message: `Add a note for the issue recorded under ${missingIssueNote.label}.` }, { status: 400 });
    }

    const { data, error } = await createAdminSupabaseClient().rpc("complete_end_of_day_checklist", {
      p_service_date: body.serviceDate,
      p_submitted_by_profile_id: actor.userId,
      p_responses: responses
    });

    if (error || !data?.[0]) {
      throw new Error(error?.message || "The end-of-day checklist could not be completed.");
    }

    return NextResponse.json({ ok: true, record: mapEndOfDayChecklistRecord(data[0]) });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to complete the end-of-day checklist.";
    const status = error instanceof AdminAuthorizationError ? error.status : error instanceof OperationsSchemaMissingError ? 503 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
