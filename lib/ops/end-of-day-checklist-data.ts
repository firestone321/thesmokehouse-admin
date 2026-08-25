import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { mapEndOfDayChecklistRecord, type EndOfDayChecklistRecord } from "@/lib/ops/end-of-day-checklist";

const endOfDayChecklistMigrationFiles = ["db/phase-77-end-of-day-checklist-activation-9pm.sql"];
const endOfDayChecklistSelection = "service_date,responses,submitted_by_email_snapshot,submitted_by_role_snapshot,submitted_at";

function throwEndOfDayChecklistError(error: { message?: string | null; details?: string | null; hint?: string | null; code?: string | null }) {
  const message = [error.message, error.details, error.hint, error.code ? `code=${error.code}` : null]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" | ");
  const normalized = message.toLowerCase();

  if (normalized.includes("could not find the table") || normalized.includes("relation") && normalized.includes("does not exist")) {
    throw new OperationsSchemaMissingError(
      `End-of-day checklist is not available yet: ${message || "the checklist table is missing"}`,
      endOfDayChecklistMigrationFiles
    );
  }

  throw new Error(`Unable to load end-of-day checklist: ${message || "unknown database error"}`);
}

export async function getEndOfDayChecklist(serviceDate: string): Promise<EndOfDayChecklistRecord | null> {
  const { data, error } = await createAdminSupabaseClient()
    .from("end_of_day_checklists")
    .select(endOfDayChecklistSelection)
    .eq("service_date", serviceDate)
    .maybeSingle();

  if (error) throwEndOfDayChecklistError(error);
  return data ? mapEndOfDayChecklistRecord(data) : null;
}

export async function getEndOfDayChecklistHistory(limit = 90): Promise<EndOfDayChecklistRecord[]> {
  const { data, error } = await createAdminSupabaseClient()
    .from("end_of_day_checklists")
    .select(endOfDayChecklistSelection)
    .order("service_date", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 180));

  if (error) throwEndOfDayChecklistError(error);
  return (data ?? []).map(mapEndOfDayChecklistRecord);
}
