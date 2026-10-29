import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./pos-test-loader.mjs";
const { dispatchCashHardware } = loadTs("lib/pos/hardware-dispatch.ts");
test("drawer completes its request before receipt dispatch; receipt can remain pending", async () => {
  const calls=[]; let release; const pending = new Promise(r=>{release=r;});
  const task=dispatchCashHardware(async()=>{calls.push("drawer");},async()=>{calls.push("receipt");await pending;});
  await new Promise(r=>setImmediate(r)); assert.deepEqual(calls,["drawer","receipt"]); release(); await task;
});
test("drawer rejection does not suppress receipt",async()=>{
  const calls=[]; await assert.rejects(dispatchCashHardware(async()=>{calls.push("drawer");throw Error("rejected");},async()=>{calls.push("receipt");}));
  assert.deepEqual(calls,["drawer","receipt"]);
});
test("receipt rejection occurs only after independent drawer dispatch",async()=>{
  const calls=[]; await assert.rejects(dispatchCashHardware(async()=>{calls.push("drawer");},async()=>{calls.push("receipt");throw Error("failed");}));
  assert.deepEqual(calls,["drawer","receipt"]);
});