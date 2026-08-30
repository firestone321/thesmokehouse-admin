"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canApproveOperationalChanges, requireDashboardRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function positiveInteger(value: string, allowZero = false) {
  const parsed = Number(value.replace(/[\s,]/g, ""));
  return Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0) ? parsed : null;
}

export async function recordFinancialTransferAction(formData: FormData) {
  const actor = await requireDashboardRole();
  const back = (message: string) => `/reports?transferMessage=${encodeURIComponent(message)}`;
  if (!canApproveOperationalChanges(actor.role)) redirect(back("Only an administrator or manager can record a deposit."));

  const fromAccountId = positiveInteger(text(formData, "fromAccountId"));
  const toAccountId = positiveInteger(text(formData, "toAccountId"));
  const amountUgx = positiveInteger(text(formData, "amountUgx"));
  const feeAmountUgx = positiveInteger(text(formData, "feeAmountUgx") || "0", true);
  const transferredAtLocal = text(formData, "transferredAt");
  const externalReference = text(formData, "externalReference") || null;
  const notes = text(formData, "notes") || null;
  const idempotencyKey = text(formData, "idempotencyKey");
  const transferredAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(transferredAtLocal)
    ? `${transferredAtLocal}:00+03:00`
    : null;

  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId || !amountUgx || feeAmountUgx === null || !transferredAt || !idempotencyKey || (notes?.length ?? 0) > 2000 || (externalReference?.length ?? 0) > 255) {
    redirect(back("Enter valid deposit details."));
  }

  const { data, error } = await createAdminSupabaseClient().rpc("record_financial_transfer", {
    p_from_account_id: fromAccountId,
    p_to_account_id: toAccountId,
    p_amount_ugx: amountUgx,
    p_transferred_at: transferredAt,
    p_external_reference: externalReference,
    p_notes: notes,
    p_fee_amount_ugx: feeAmountUgx,
    p_created_by: actor.userId,
    p_idempotency_key: idempotencyKey
  });

  if (error) redirect(back(`Unable to record deposit: ${error.message}`));
  const saved = Array.isArray(data) ? data[0] : data;
  revalidatePath("/reports");
  redirect(back(`Deposit ${saved?.transfer_number ?? ""} recorded.`));
}
