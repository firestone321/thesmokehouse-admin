import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync(new URL("../db/phase-83-cash-movement-and-reconciliation.sql", import.meta.url), "utf8");

test("internal transfers create two opposite account consequences without ledger Money In or Money Out", () => {
  assert.match(sql, /financial_account_movements[\s\S]*-p_amount_ugx[\s\S]*p_amount_ugx/);
  assert.doesNotMatch(sql, /'money_in'[\s\S]{0,500}financial_transfer/);
  assert.match(sql, /'money_out'[\s\S]*'financial_transfer_fee'/);
});

test("transfer idempotency and source uniqueness are database enforced", () => {
  assert.match(sql, /unique \(idempotency_key\)/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(sql, /financial_transfer_idempotency_conflict/);
  assert.match(sql, /unique \(transfer_id, account_id\)/i);
});

test("daily cash formula uses sale amount, cash out, and transfers", () => {
  assert.match(sql, /sum\(t\.amount\)/);
  assert.doesNotMatch(sql, /sum\(t\.amount_received\)/);
  assert.match(sql, /p_opening_cash_ugx[\s\S]*cash_sales\.amount[\s\S]*- cash_out\.amount[\s\S]*- transfers\.cash_out[\s\S]*\+ transfers\.cash_in/);
  assert.match(sql, /p_actual_cash_counted_ugx - v_reconciliation\.expected_cash_ugx/);
});

test("cash deposit expectation is an alert and not a close blocker", () => {
  assert.match(sql, /mobile_money_deposit_recorded/);
  assert.match(sql, /cash_activity_exists/);
  assert.doesNotMatch(sql, /raise exception '.*deposit.*required/i);
});

test("Phase 83 is server-only and does not backfill historical financial activity", () => {
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
  assert.match(sql, /revoke all on function public\.get_financial_transfer_summary\(date,date\)/);
  assert.match(sql, /grant execute on function public\.get_financial_transfer_summary\(date,date\)/);
  assert.doesNotMatch(sql, /truncate\s/i);
  assert.doesNotMatch(sql, /insert into public\.financial_transfers[\s\S]*select[\s\S]*from public\.(orders|procurement_receipts)/i);
});
