import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../db/phase-81-daily-close-aggregation.sql", import.meta.url),
  "utf8"
);
const dataLoader = readFileSync(
  new URL("../lib/reports/daily-close-data.ts", import.meta.url),
  "utf8"
);

test("Daily Close delegates uncapped aggregation to PostgreSQL", () => {
  assert.match(dataLoader, /rpc\("get_daily_close_summary"/);
  assert.doesNotMatch(dataLoader, /range\(0, 9999\)/);
  assert.match(sql, /with day_orders as materialized/);
  assert.match(sql, /where o\.service_date = p_service_date/);
});

test("Daily Close preserves payment and terminal-state rules", () => {
  assert.match(sql, /o\.payment_status = 'paid' and o\.status <> 'cancelled'/);
  assert.match(sql, /o\.order_source = 'pos' and o\.status = 'ready'/);
  assert.match(sql, /order_source = 'pos' and status = 'ready'/);
  assert.match(sql, /coalesce\(o\.payment_status, ''\) <> 'paid'/);
});

test("Daily Close returns a bounded exception preview and all tender buckets", () => {
  assert.match(sql, /limit 12/);
  assert.match(sql, /'cash'::text/);
  assert.match(sql, /'mobile_money'::text/);
  assert.match(sql, /'card'::text/);
  assert.match(sql, /sum\(t\.amount_received\)/);
  assert.match(sql, /sum\(t\.change_given\)/);
});

test("Daily Close aggregation RPC is service-role only", () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
});
