import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import {
  mapDailyOperationsChecklistRecord,
  type DailyOperationsChecklistRecord
} from "@/lib/ops/daily-checklist";

const dailyChecklistMigrationFiles = ["db/phase-75-daily-operations-checklist.sql"];
const dailyChecklistSelection = "service_date,responses,submitted_by_email_snapshot,submitted_by_role_snapshot,submitted_at";

function throwDailyChecklistError(error: { message?: string | null; details?: string | null; hint?: string | null; code?: string | null }) {
  const message = [error.message, error.details, error.hint, error.code ? `code=${error.code}` : null]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" | ");
  const normalized = message.toLowerCase();

  if (normalized.includes("could not find the table") || normalized.includes("relation") && normalized.includes("does not exist")) {
    throw new OperationsSchemaMissingError(
      `Daily operations checklist is not available yet: ${message || "the checklist table is missing"}`,
      dailyChecklistMigrationFiles
    );
  }

  throw new Error(`Unable to load daily operations checklist: ${message || "unknown database error"}`);
}

export async function getDailyOperationsChecklist(serviceDate: string): Promise<DailyOperationsChecklistRecord | null> {
  const { data, error } = await createAdminSupabaseClient()
    .from("daily_operations_checklists")
    .select(dailyChecklistSelection)
    .eq("service_date", serviceDate)
    .maybeSingle();

  if (error) throwDailyChecklistError(error);
  return data ? mapDailyOperationsChecklistRecord(data) : null;
}

export async function getDailyOperationsChecklistHistory(limit = 90): Promise<DailyOperationsChecklistRecord[]> {
  const { data, error } = await createAdminSupabaseClient()
    .from("daily_operations_checklists")
    .select(dailyChecklistSelection)
    .order("service_date", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 180));

  if (error) throwDailyChecklistError(error);
  return (data ?? []).map(mapDailyOperationsChecklistRecord);
}
