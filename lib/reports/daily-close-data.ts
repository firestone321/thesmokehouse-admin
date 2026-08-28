import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { getEndOfDayChecklist } from "@/lib/ops/end-of-day-checklist-data";
import type { EndOfDayChecklistRecord } from "@/lib/ops/end-of-day-checklist";

export type DailyCloseOrder = { id: number; orderNumber: string; orderSource: "pos" | "storefront"; status: string; paymentStatus: string; totalAmount: number };
export type DailyCloseSnapshot = { id: string; closedByEmail: string; closedByRole: string; closedAt: string; openingFloat: number; cashCounted: number; expectedPosCash: number; cashDifference: number; notes: string | null };
export type DailyCloseData = { serviceDate: string; totalSales: number; posSales: number; onlineSales: number; completedPaidSales: number; completedOrders: number; cancelledOrders: number; pendingPaymentOrders: number; openPaidOrders: DailyCloseOrder[]; posTenders: Array<{ type: "cash" | "mobile_money" | "card"; count: number; amount: number; received: number; change: number }>; expectedPosCash: number; checklist: EndOfDayChecklistRecord | null; snapshot: DailyCloseSnapshot | null };
const tenderTypes = ["cash", "mobile_money", "card"] as const;
const number = (value: unknown) => { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];

export async function getDailyCloseData(serviceDate: string): Promise<DailyCloseData> {
  const supabase = createAdminSupabaseClient();
  const [summaryResponse, snapshotResponse, checklist] = await Promise.all([
    supabase.rpc("get_daily_close_summary", { p_service_date: serviceDate }),
    supabase.from("daily_close_snapshots").select("id,closed_by_email_snapshot,closed_by_role_snapshot,closed_at,opening_float_ugx,cash_counted_ugx,expected_pos_cash_ugx,cash_difference_ugx,notes").eq("service_date", serviceDate).maybeSingle(),
    getEndOfDayChecklist(serviceDate)
  ]);
  if (summaryResponse.error) throw new Error(`Unable to load Daily Close summary: ${summaryResponse.error.message}`);
  if (snapshotResponse.error && !snapshotResponse.error.message.toLowerCase().includes("does not exist")) throw new Error(`Unable to load Daily Close snapshot: ${snapshotResponse.error.message}`);
  const summary = record(Array.isArray(summaryResponse.data) ? summaryResponse.data[0] : summaryResponse.data);
  const openPaidOrders = rows(summary.open_paid_orders).map((order): DailyCloseOrder => ({ id: number(order.id), orderNumber: String(order.order_number), orderSource: order.order_source === "pos" ? "pos" : "storefront", status: String(order.status), paymentStatus: String(order.payment_status), totalAmount: number(order.total_amount) }));
  const tenderRows = rows(summary.pos_tenders);
  const posTenders = tenderTypes.map((type) => { const tender = tenderRows.find((entry) => entry.type === type) ?? {}; return { type, count: number(tender.count), amount: number(tender.amount), received: number(tender.received), change: number(tender.change) }; });
  const row = snapshotResponse.data;
  return { serviceDate, totalSales: number(summary.total_sales), posSales: number(summary.pos_sales), onlineSales: number(summary.online_sales), completedPaidSales: number(summary.completed_paid_sales), completedOrders: number(summary.completed_orders), cancelledOrders: number(summary.cancelled_orders), pendingPaymentOrders: number(summary.pending_payment_orders), openPaidOrders, posTenders, expectedPosCash: number(summary.expected_pos_cash), checklist, snapshot: row ? { id: String(row.id), closedByEmail: String(row.closed_by_email_snapshot), closedByRole: String(row.closed_by_role_snapshot), closedAt: String(row.closed_at), openingFloat: number(row.opening_float_ugx), cashCounted: number(row.cash_counted_ugx), expectedPosCash: number(row.expected_pos_cash_ugx), cashDifference: number(row.cash_difference_ugx), notes: typeof row.notes === "string" ? row.notes : null } : null };
}
