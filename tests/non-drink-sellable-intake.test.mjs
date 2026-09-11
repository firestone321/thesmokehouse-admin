import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const form = fs.readFileSync("components/procurement/sides-intake-form.tsx", "utf8");
const actions = fs.readFileSync("lib/ops/actions.ts", "utf8");
const queries = fs.readFileSync("lib/ops/queries.ts", "utf8");

test("Sides and Accompaniments use one portion dropdown with a one-time link", () => {
  assert.match(queries, /\["sides", "accompaniments"\]/);
  assert.match(form, /Choose portion/);
  assert.match(form, /— link once/);
  assert.match(form, /Link this portion/);
  assert.match(form, /You will not need to do this again\./);
  assert.match(form, /formData\.set\("direct_sellable_portion_type_id"/);
  assert.match(form, /formData\.set\("source_menu_item_id"/);
  assert.match(queries, /stock_source_portion_type_id/);
  assert.match(queries, /Shared stock:/);
});

test("non-drink ready-to-sell intake is always one-to-one and whole-numbered", () => {
  assert.match(actions, /sellable_units_per_input: hasSellableTarget \? 1/);
  assert.match(actions, /requires_whole_input: hasSellableTarget/);
  assert.match(actions, /\["sides", "accompaniments"\]\.includes/);
  assert.match(actions, /stockPoolPortionTypeId !== input\.direct_sellable_portion_type_id/);
  assert.match(form, /Restocking amount/);
  assert.match(form, /Enter how many of the selected portion are being added\./);
});

test("raw inputs remain a separate choice", () => {
  assert.match(form, /Add something that needs preparation/);
  assert.match(form, /Add raw input/);
  assert.match(form, /How is it counted\? For example kg/);
  assert.match(form, /item\.sourceMenuCategoryCode === "drinks"/);
  assert.match(form, /item\.sourceMenuCategoryCode !== "drinks"/);
});
