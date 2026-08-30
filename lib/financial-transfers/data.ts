import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/server";
import type { FinancialAccount, FinancialTransfer } from "@/lib/financial-transfers/types";

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getFinancialTransferData(startDate: string, endDateExclusive: string) {
  const db = createAdminSupabaseClient();
  const [accountsResponse, transfersResponse, summaryResponse] = await Promise.all([
    db.from("financial_accounts").select("id,name,account_type").eq("is_active", true).order("name"),
    db.from("financial_transfers")
      .select("id,transfer_number,amount_ugx,service_date,transferred_at,external_reference,notes,fee_amount_ugx,created_by_email_snapshot,from_account:financial_accounts!financial_transfers_from_account_id_fkey(name),to_account:financial_accounts!financial_transfers_to_account_id_fkey(name)")
      .is("reversed_at", null)
      .order("transferred_at", { ascending: false })
      .limit(50),
    db.rpc("get_financial_transfer_summary", { p_start_date: startDate, p_end_date_exclusive: endDateExclusive })
  ]);

  if (accountsResponse.error) throw new Error(`Unable to load financial accounts: ${accountsResponse.error.message}`);
  if (transfersResponse.error) throw new Error(`Unable to load financial transfers: ${transfersResponse.error.message}`);
  if (summaryResponse.error) throw new Error(`Unable to load transfer summary: ${summaryResponse.error.message}`);

  const accounts: FinancialAccount[] = (accountsResponse.data ?? []).map((row) => ({
    id: number(row.id),
    name: String(row.name),
    accountType: row.account_type as FinancialAccount["accountType"]
  }));

  const transfers: FinancialTransfer[] = (transfersResponse.data ?? []).map((row: any) => ({
    id: number(row.id),
    transferNumber: String(row.transfer_number),
    fromAccount: String(Array.isArray(row.from_account) ? row.from_account[0]?.name : row.from_account?.name),
    toAccount: String(Array.isArray(row.to_account) ? row.to_account[0]?.name : row.to_account?.name),
    amountUgx: number(row.amount_ugx),
    serviceDate: String(row.service_date),
    transferredAt: String(row.transferred_at),
    externalReference: typeof row.external_reference === "string" ? row.external_reference : null,
    notes: typeof row.notes === "string" ? row.notes : null,
    feeAmountUgx: number(row.fee_amount_ugx),
    createdBy: String(row.created_by_email_snapshot)
  }));

  const summaryRow = Array.isArray(summaryResponse.data) ? summaryResponse.data[0] : summaryResponse.data;
  return {
    accounts,
    transfers,
    summary: {
      transferCount: number(summaryRow?.transfer_count),
      totalTransferredUgx: number(summaryRow?.total_transferred_ugx),
      cashToMobileMoneyUgx: number(summaryRow?.cash_to_mobile_money_ugx)
    }
  };
}
