import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { getEndOfDayChecklist } from "@/lib/ops/end-of-day-checklist-data";
import type { EndOfDayChecklistRecord } from "@/lib/ops/end-of-day-checklist";

export type DailyCloseOrder = { id: number; orderNumber: string; orderSource: "pos" | "storefront"; status: string; paymentStatus: string; totalAmount: number };
export type DailyCloseSnapshot = { id: string; closedByEmail: string; closedByRole: string; closedAt: string; openingFloat: number; cashCounted: number; expectedPosCash: number; cashDifference: number; notes: string | null };
export type DailyCloseData = { serviceDate: string; totalSales: number; posSales: number; onlineSales: number; completedPaidSales: number; completedOrders: number; cancelledOrders: number; pendingPaymentOrders: number; openPaidOrders: DailyCloseOrder[]; posTenders: Array<{ type: "cash" | "mobile_money" | "card"; count: number; amount: number; received: number; change: number }>; expectedPosCash: number; checklist: EndOfDayChecklistRecord | null; snapshot: DailyCloseSnapshot | null };
const tenderTypes = ["cash", "mobile_money", "card"] as const;
const number = (value: unknown) => { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; };
const isTerminalSale = (order: DailyCloseOrder) => order.status === "completed" || (order.orderSource === "pos" && order.status === "ready");

export async function getDailyCloseData(serviceDate: string): Promise<DailyCloseData> {
  const supabase = createAdminSupabaseClient();
  const [ordersResponse, snapshotResponse, checklist] = await Promise.all([
    supabase.from("orders").select("id,order_number,order_source,status,payment_status,total_amount").eq("service_date", serviceDate).order("created_at", { ascending: false }).range(0, 9999),
    supabase.from("daily_close_snapshots").select("id,closed_by_email_snapshot,closed_by_role_snapshot,closed_at,opening_float_ugx,cash_counted_ugx,expected_pos_cash_ugx,cash_difference_ugx,notes").eq("service_date", serviceDate).maybeSingle(),
    getEndOfDayChecklist(serviceDate)
  ]);
  if (ordersResponse.error) throw new Error(`Unable to load Daily Close orders: ${ordersResponse.error.message}`);
  if (snapshotResponse.error && !snapshotResponse.error.message.toLowerCase().includes("does not exist")) throw new Error(`Unable to load Daily Close snapshot: ${snapshotResponse.error.message}`);
  const orders = (ordersResponse.data ?? []).map((order): DailyCloseOrder => ({ id: number(order.id), orderNumber: String(order.order_number), orderSource: order.order_source === "pos" ? "pos" : "storefront", status: String(order.status), paymentStatus: String(order.payment_status), totalAmount: number(order.total_amount) }));
  const eligiblePaid = orders.filter((order) => order.paymentStatus === "paid" && order.status !== "cancelled");
  const posOrderIds = eligiblePaid.filter((order) => order.orderSource === "pos").map((order) => order.id);
  const tenderResponse = posOrderIds.length === 0 ? { data: [], error: null } : await supabase.from("pos_tenders").select("order_id,tender_type,amount,amount_received,change_given").in("order_id", posOrderIds).range(0, 9999);
  if (tenderResponse.error) throw new Error(`Unable to load POS tenders: ${tenderResponse.error.message}`);
  const posTenders = tenderTypes.map((type) => { const entries = (tenderResponse.data ?? []).filter((tender) => tender.tender_type === type); return { type, count: entries.length, amount: entries.reduce((total, tender) => total + number(tender.amount), 0), received: entries.reduce((total, tender) => total + number(tender.amount_received), 0), change: entries.reduce((total, tender) => total + number(tender.change_given), 0) }; });
  const posSales = eligiblePaid.filter((order) => order.orderSource === "pos").reduce((total, order) => total + order.totalAmount, 0);
  const onlineSales = eligiblePaid.filter((order) => order.orderSource === "storefront").reduce((total, order) => total + order.totalAmount, 0);
  const row = snapshotResponse.data;
  const terminalPaidOrders = orders.filter((order) => order.paymentStatus === "paid" && isTerminalSale(order));
  return { serviceDate, totalSales: posSales + onlineSales, posSales, onlineSales, completedPaidSales: terminalPaidOrders.reduce((total, order) => total + order.totalAmount, 0), completedOrders: terminalPaidOrders.length, cancelledOrders: orders.filter((order) => order.status === "cancelled").length, pendingPaymentOrders: orders.filter((order) => order.status !== "cancelled" && order.paymentStatus !== "paid").length, openPaidOrders: eligiblePaid.filter((order) => !isTerminalSale(order)).slice(0, 12), posTenders, expectedPosCash: posTenders.find((tender) => tender.type === "cash")?.amount ?? 0, checklist, snapshot: row ? { id: String(row.id), closedByEmail: String(row.closed_by_email_snapshot), closedByRole: String(row.closed_by_role_snapshot), closedAt: String(row.closed_at), openingFloat: number(row.opening_float_ugx), cashCounted: number(row.cash_counted_ugx), expectedPosCash: number(row.expected_pos_cash_ugx), cashDifference: number(row.cash_difference_ugx), notes: typeof row.notes === "string" ? row.notes : null } : null };
}
