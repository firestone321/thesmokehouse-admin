"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDashboardRole, canApproveOperationalChanges } from "@/lib/auth/admin-role";
import { recordStaffActivity } from "@/lib/activity/log";
import { getEndOfDayChecklist } from "@/lib/ops/end-of-day-checklist-data";
import { getUgandaServiceDate, isEndOfDayChecklistActive } from "@/lib/ops/utils";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { getDailyCloseData } from "@/lib/reports/daily-close-data";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function amount(value: FormDataEntryValue | null) { const parsed = Number(String(value ?? "").replace(/[\s,]/g, "")); return Number.isInteger(parsed) && parsed >= 0 ? parsed : null; }
export async function signOffDailyCloseAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardRole(); const serviceDate = String(formData.get("serviceDate") ?? "").trim(); const openingFloat = amount(formData.get("openingFloat")); const cashCounted = amount(formData.get("cashCounted")); const notes = String(formData.get("notes") ?? "").trim() || null;
  const path = (message: string) => `/reports?date=${encodeURIComponent(serviceDate)}&dailyCloseMessage=${encodeURIComponent(message)}`;
  if (!canApproveOperationalChanges(actor.role) || !ISO_DATE.test(serviceDate) || openingFloat === null || cashCounted === null || (notes?.length ?? 0) > 2000) redirect(path("Invalid daily close details."));
  const today = getUgandaServiceDate(); if (serviceDate > today || (serviceDate === today && !isEndOfDayChecklistActive())) redirect(path("This service day can only be signed off from 9:00 PM EAT."));
  if (!await getEndOfDayChecklist(serviceDate)) redirect(path("Complete the end-of-day checklist before signing off."));
  const data = await getDailyCloseData(serviceDate); if (data.snapshot) redirect(path("This service day is already locked."));
  const cashDifference = cashCounted - openingFloat - data.expectedPosCash;
  const { data: saved, error } = await createAdminSupabaseClient().from("daily_close_snapshots").insert({ service_date: serviceDate, closed_by_profile_id: actor.userId, closed_by_email_snapshot: actor.email ?? "Unknown manager", closed_by_role_snapshot: actor.role, opening_float_ugx: openingFloat, cash_counted_ugx: cashCounted, expected_pos_cash_ugx: data.expectedPosCash, cash_difference_ugx: cashDifference, snapshot: data, notes }).select("id").single();
  if (error) redirect(path(error.code === "23505" ? "This service day is already locked." : `Unable to sign off: ${error.message}`));
  await recordStaffActivity({ actor, action: "daily_close.signed_off", entityType: "daily_close_snapshot", entityId: saved.id, summary: `${actor.email ?? "A manager"} signed off Daily Close for ${serviceDate}.`, metadata: { serviceDate, openingFloat, cashCounted, expectedPosCash: data.expectedPosCash, cashDifference } });
  revalidatePath("/reports"); redirect(path("Daily Close signed off and locked."));
}