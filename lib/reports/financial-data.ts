import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
export async function getFinancialSummary(startDate: string, endDateExclusive: string) {
  const { data, error } = await createAdminSupabaseClient().from("financial_transactions").select("direction,amount_ugx").gte("transaction_date", startDate).lt("transaction_date", endDateExclusive).is("voided_at", null);
  if (error) throw new Error(`Unable to load financial transactions: ${error.message}`);
  const moneyOut = (data ?? []).filter((row) => row.direction === "money_out").reduce((sum, row) => sum + Number(row.amount_ugx), 0);
  const moneyIn = (data ?? []).filter((row) => row.direction === "money_in").reduce((sum, row) => sum + Number(row.amount_ugx), 0);
  return { moneyIn, moneyOut, netCashMovement: moneyIn - moneyOut };
}
