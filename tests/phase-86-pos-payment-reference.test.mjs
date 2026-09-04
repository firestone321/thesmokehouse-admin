import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(
  new URL("../components/pos/pos-sale-workspace.tsx", import.meta.url),
  "utf8"
);
const schema = readFileSync(new URL("../lib/schemas/admin.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../db/phase-86-pos-payment-reference-fragment.sql", import.meta.url),
  "utf8"
);

test("non-cash POS sales accept only a full 11-digit terminal reference or its last four digits", () => {
  assert.match(workspace, /\^\(\?:\\d\{4\}\|\\d\{11\}\)\$/);
  assert.match(workspace, /Full reference or last 4 digits/);
  assert.match(schema, /regex\(\/\^\(\?:\\d\{4\}\|\\d\{11\}\)\$\//);
  assert.match(migration, /\^\(\?:\[0-9\]\{4\}\|\[0-9\]\{11\}\)\$/);
});
