import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("components/procurement/sides-intake-form.tsx", "utf8");

test("piece-based sides intake uses a Pieces Received field", () => {
  assert.match(source, /receivesPieces/);
  assert.match(source, /"Pieces Received"/);
  assert.match(source, /min=\{selectedItem\?\.requiresWholeInput \? "1"/);
  assert.match(source, /step=\{selectedItem\?\.requiresWholeInput \? "1"/);
});
