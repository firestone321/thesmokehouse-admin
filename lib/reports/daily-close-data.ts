import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { getEndOfDayChecklist } from "@/lib/ops/end-of-day-checklist-data";
import type { EndOfDayChecklistRecord } from "@/lib/ops/end-of-day-checklist";

export type DailyCloseOrder = { id: number; orderNumber: string; orderSource: "pos" | "storefront"; status: string; paymentStatus: string; totalAmount: number };
export type CashReconciliation = { cashSales: number; cashMoneyOut: number; cashTransfersOut: number; cashTransfersIn: number; expectedCashBeforeOpening: number; cashActivityExists: boolean; mobileMoneyDepositRecorded: boolean };
export type DailyCloseSnapshot = { id: string; closedByEmail: string; closedByRole: string; closedAt: string; openingFloat: number; cashCounted: number; expectedPosCash: number; expectedCash: number; cashMoneyOut: number; cashTransfersOut: number; cashTransfersIn: number; cashDifference: number; depositExpected: boolean; mobileMoneyDepositRecorded: boolean; notes: string | null };
export type DailyCloseData = { serviceDate: string; totalSales: number; posSales: number; onlineSales: number; completedPaidSales: number; completedOrders: number; cancelledOrders: number; pendingPaymentOrders: number; openPaidOrders: DailyCloseOrder[]; posTenders: Array<{ type: "cash" | "mobile_money" | "card"; count: number; amount: number; received: number; change: number }>; expectedPosCash: number; cashReconciliation: CashReconciliation; checklist: EndOfDayChecklistRecord | null; snapshot: DailyCloseSnapshot | null };
const tenderTypes = ["cash", "mobile_money", "card"] as const;
const number = (value: unknown) => { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];

export async function getDailyCloseData(serviceDate: string): Promise<DailyCloseData> {
  const supabase = createAdminSupabaseClient();
  const [summaryResponse, reconciliationResponse, snapshotResponse, checklist] = await Promise.all([
    supabase.rpc("get_daily_close_summary", { p_service_date: serviceDate }),
    supabase.rpc("get_daily_cash_reconciliation", { p_service_date: serviceDate, p_opening_cash_ugx: 0 }),
    supabase.from("daily_close_snapshots").select("id,closed_by_email_snapshot,closed_by_role_snapshot,closed_at,opening_float_ugx,cash_counted_ugx,expected_pos_cash_ugx,expected_cash_ugx,cash_money_out_ugx,cash_transfers_out_ugx,cash_transfers_in_ugx,cash_difference_ugx,deposit_expected,mobile_money_deposit_recorded,notes").eq("service_date", serviceDate).maybeSingle(),
    getEndOfDayChecklist(serviceDate)
  ]);
  if (summaryResponse.error) throw new Error(`Unable to load Daily Close summary: ${summaryResponse.error.message}`);
  if (reconciliationResponse.error) throw new Error(`Unable to load cash reconciliation: ${reconciliationResponse.error.message}`);
  if (snapshotResponse.error && !snapshotResponse.error.message.toLowerCase().includes("does not exist")) throw new Error(`Unable to load Daily Close snapshot: ${snapshotResponse.error.message}`);
  const summary = record(Array.isArray(summaryResponse.data) ? summaryResponse.data[0] : summaryResponse.data);
  const reconciliation = record(Array.isArray(reconciliationResponse.data) ? reconciliationResponse.data[0] : reconciliationResponse.data);
  const openPaidOrders = rows(summary.open_paid_orders).map((order): DailyCloseOrder => ({ id: number(order.id), orderNumber: String(order.order_number), orderSource: order.order_source === "pos" ? "pos" : "storefront", status: String(order.status), paymentStatus: String(order.payment_status), totalAmount: number(order.total_amount) }));
  const tenderRows = rows(summary.pos_tenders);
  const posTenders = tenderTypes.map((type) => { const tender = tenderRows.find((entry) => entry.type === type) ?? {}; return { type, count: number(tender.count), amount: number(tender.amount), received: number(tender.received), change: number(tender.change) }; });
  const row = snapshotResponse.data;
  return {
    serviceDate,
    totalSales: number(summary.total_sales), posSales: number(summary.pos_sales), onlineSales: number(summary.online_sales), completedPaidSales: number(summary.completed_paid_sales), completedOrders: number(summary.completed_orders), cancelledOrders: number(summary.cancelled_orders), pendingPaymentOrders: number(summary.pending_payment_orders), openPaidOrders, posTenders, expectedPosCash: number(summary.expected_pos_cash),
    cashReconciliation: { cashSales: number(reconciliation.cash_sales_ugx), cashMoneyOut: number(reconciliation.cash_money_out_ugx), cashTransfersOut: number(reconciliation.cash_transfers_out_ugx), cashTransfersIn: number(reconciliation.cash_transfers_in_ugx), expectedCashBeforeOpening: number(reconciliation.expected_cash_ugx), cashActivityExists: reconciliation.cash_activity_exists === true, mobileMoneyDepositRecorded: reconciliation.mobile_money_deposit_recorded === true },
    checklist,
    snapshot: row ? { id: String(row.id), closedByEmail: String(row.closed_by_email_snapshot), closedByRole: String(row.closed_by_role_snapshot), closedAt: String(row.closed_at), openingFloat: number(row.opening_float_ugx), cashCounted: number(row.cash_counted_ugx), expectedPosCash: number(row.expected_pos_cash_ugx), expectedCash: number(row.expected_cash_ugx), cashMoneyOut: number(row.cash_money_out_ugx), cashTransfersOut: number(row.cash_transfers_out_ugx), cashTransfersIn: number(row.cash_transfers_in_ugx), cashDifference: number(row.cash_difference_ugx), depositExpected: row.deposit_expected === true, mobileMoneyDepositRecorded: row.mobile_money_deposit_recorded === true, notes: typeof row.notes === "string" ? row.notes : null } : null
  };
}