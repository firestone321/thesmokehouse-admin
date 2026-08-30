"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDashboardRole, canApproveOperationalChanges } from "@/lib/auth/admin-role";
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
  const { data: saved, error } = await createAdminSupabaseClient().rpc("sign_off_daily_close_v2", { p_service_date: serviceDate, p_opening_cash_ugx: openingFloat, p_actual_cash_counted_ugx: cashCounted, p_notes: notes, p_closed_by: actor.userId, p_snapshot: data });
  if (error) redirect(path(error.code === "23505" ? "This service day is already locked." : `Unable to sign off: ${error.message}`));
  const row = Array.isArray(saved) ? saved[0] : saved;
  revalidatePath("/reports"); redirect(path(`Daily Close signed off. Expected cash: ${Number(row?.expected_cash_ugx ?? 0).toLocaleString("en-UG")} UGX; variance: ${Number(row?.variance_ugx ?? 0).toLocaleString("en-UG")} UGX.`));
}