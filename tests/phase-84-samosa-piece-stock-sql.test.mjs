import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../db/phase-84-samosa-piece-stock-repair.sql", import.meta.url), "utf8");

test("Samosa is repaired as one piece with thirteen historical units", () => {
  assert.match(sql, /portion_label = '1 piece'/);
  assert.match(sql, /unit_name = 'pieces'/);
  assert.match(sql, /sellable_units_per_input = 1/);
  assert.match(sql, /requires_whole_input = true/);
  assert.match(sql, /quantity_received = 13/);
  assert.match(sql, /current_quantity = 0/);
  assert.match(sql, /quantity_delta,\s*resulting_quantity,[\s\S]*-13,\s*0,/);
  assert.match(sql, /values \(v_portion_type\.id, 13\)/);
});

test("Samosa repair fails closed if sales or stock already exist", () => {
  assert.match(sql, /phase_84_samosa_sales_exist_review_before_repair/);
  assert.match(sql, /phase_84_samosa_stock_already_exists/);
  assert.match(sql, /phase_84_samosa_receipt_baseline_changed/);
});
