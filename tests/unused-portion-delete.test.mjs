import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const form = fs.readFileSync("components/menu/menu-item-form.tsx", "utf8");
const actions = fs.readFileSync("lib/ops/actions.ts", "utf8");

test("menu form shows guarded delete controls only for unused portions", () => {
  assert.match(form, /portionOptions\.filter\(\(portion\) => portion\.isUnused\)/);
  assert.match(form, /Remove an unused portion/);
  assert.match(form, /aria-label={`Delete unused portion/);
  assert.match(form, /A final safety check runs before deletion\./);
});

test("server rechecks every operational portion reference before deletion", () => {
  for (const table of [
    "menu_items",
    "daily_stock",
    "finished_stock",
    "finished_stock_movements",
    "processing_batches",
    "protein_intake_item_portions",
    "inventory_items",
    "portion_types",
    "menu_item_stock_requirements"
  ]) {
    assert.match(actions, new RegExp(`from\\(\"${table}\"\\)`));
  }
  assert.match(actions, /error\.code === "23503"/);
});

test("new non-drink portions can be measured by weight or pieces", () => {
  assert.match(form, /By weight \(grams\)/);
  assert.match(form, /By pieces/);
  assert.match(actions, /input\.unit === "piece"/);
});
