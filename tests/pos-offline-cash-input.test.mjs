import test from "node:test";import assert from "node:assert/strict";import {loadTs} from "./pos-test-loader.mjs";
const {buildOfflineCashInput:build}=loadTs("lib/pos/offline-cash-input.ts");
const input={transactionId:"10000000-0000-4000-8000-000000000001",catalogVersion:"20000000-0000-4000-8000-000000000001",catalog:[{menuItemId:1,name:"Item",unitPrice:2000,available:3}],items:[{menuItemId:1,quantity:2}],amountReceived:5000,tenderType:"cash",unresolvedCloudAttempt:false};
test("cash checkout uses authorized price and stock",()=>{const x=build(input);assert.equal(x.expectedTotal,4000);assert.equal(x.amountReceived,5000)});
test("card and mobile money are rejected",()=>{for(const tenderType of ["card","mobile_money"])assert.throws(()=>build({...input,tenderType}))});
test("unresolved cloud sale blocks local preparation",()=>assert.throws(()=>build({...input,unresolvedCloudAttempt:true})));
test("unfunded or insufficient stock rejected",()=>{assert.throws(()=>build({...input,items:[{menuItemId:2,quantity:1}]}));assert.throws(()=>build({...input,items:[{menuItemId:1,quantity:4}]}))});
test("duplicate basket and duplicate catalog rejected",()=>{assert.throws(()=>build({...input,items:[{menuItemId:1,quantity:1},{menuItemId:1,quantity:1}]}));assert.throws(()=>build({...input,catalog:[...input.catalog,...input.catalog]}))});
test("insufficient cash and stale invalid identity rejected",()=>{assert.throws(()=>build({...input,amountReceived:3999}));assert.throws(()=>build({...input,catalogVersion:"bad"}))});
