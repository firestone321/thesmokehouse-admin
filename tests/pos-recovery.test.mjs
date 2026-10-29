import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import { loadTs } from "./pos-test-loader.mjs";
const require=createRequire(import.meta.url);
const {newAttempt, restoreAttempt, hashableSale}=loadTs("lib/pos/sale-contract.ts");
const {dispatchCashHardware}=loadTs("lib/pos/hardware-dispatch.ts");
const payload={idempotencyKey:"00000000-0000-4000-8000-000000000001",tenderType:"cash",amountReceived:100,items:[{menuItemId:1,quantity:1}]};
const receipt={orderId:1,orderNumber:"1001",status:"confirmed",totalAmount:100,tenderType:"cash",amountReceived:100,changeGiven:0,hardwareEnabled:true,
  canonicalReceipt:{saleId:"1001",date:"2026-10-18T10:00:00Z",items:[{name:"Test",quantity:1,unitPrice:100,total:100}],subtotal:100,total:100,paymentMethod:"cash"}};

function harness({prior=null,fetchImpl,drawerState="submitted",recordedAttempts=[]}={}) {
  let active=prior?structuredClone(prior):null,locked=false;
  const records=new Map([...recordedAttempts.map(a=>[a.payload.idempotencyKey,structuredClone(a)]),...(prior?[[prior.payload.idempotencyKey,structuredClone(prior)]]:[])]),states=[],hardware=[],requests=[],committed=[];
  const slots=[];let cursor=0;const effects=[];
  const react={
    useState:(initial)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==="function"?v(slots[i]):v;}];},
    useRef:(value)=>{const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
    useCallback:(fn)=>fn,
    useEffect:(fn)=>{cursor++;if(!react.mounted)effects.push(fn);}
  };
  const storage={
    readActiveAttempt:async()=>active?structuredClone(active):null,
    saveAttempt:async(a,activate=true)=>{if(activate)active=structuredClone(a);records.set(a.payload.idempotencyKey,structuredClone(a));states.push(a.state);},
    readAttempt:async(owner,key)=>{const a=records.get(key);return a?.ownerId===owner?structuredClone(a):null;},
    listRecordedAttempts:async()=>[...records.values()].filter(a=>a.state==="committed").map(a=>structuredClone(a)),closeAttempt:async()=>{active=null;},watchAttempts:()=>()=>{},
    withSaleLock:async(_owner,work)=>{if(locked)throw Error("Another tab");locked=true;try{return await work();}finally{locked=false;}}
  };
  const module=loadTs("lib/pos/use-pos-sale.ts",{
    react,"./attempt-store":storage,"./sale-contract":{newAttempt,restoreAttempt,isUnresolved:s=>["prepared","submitting","outcome_unknown","needs_review"].includes(s)},
    "./hardware-dispatch":{dispatchCashHardware},
    "./hardware-client":{submitHardware:async(a,kind)=>{hardware.push(kind);return {...a.hardware[kind],state:kind==="drawer"?drawerState:"submitted"};},lookupHardware:async(a,k)=>({...a.hardware[k],state:"submitted"})},
    "./timing":{posTimer:()=>()=>{}}
  });
  function render(){cursor=0;const value=module.usePosSale("cashier",value=>committed.push(value));react.mounted=true;return value;}
  return {
    mount:async()=>{render();for(const effect of effects)effect();await new Promise(r=>setImmediate(r));return render();},
    render,read:()=>active,latest:()=>[...records.values()].at(-1),states,hardware,requests,committed,
    async execute(work){const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
      globalThis.window={addEventListener(){},removeEventListener(){},confirm:()=>true};
      globalThis.fetch=async(url,init)=>{requests.push({url,body:init?.body?JSON.parse(init.body):null});return fetchImpl?fetchImpl(url,init):{ok:true,json:async()=>({ok:true,data:receipt})};};
      try{return await work();}finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;}}
  };
}
async function initialized(h){let value;await h.execute(async()=>{value=await h.mount();});return value;}
test("cash sale is durable before POST and hardware starts only after commitment",async()=>{
  const h=harness({fetchImpl:async()=>{assert.equal(h.read().state,"submitting");assert.equal(h.hardware.length,0);return {ok:true,json:async()=>({ok:true,data:receipt})};}});
  const ui=await initialized(h);
  await h.execute(()=>ui.submit({...payload,idempotencyKey:undefined}));
  assert.equal(h.latest().state,"committed");assert.deepEqual(h.hardware,["drawer","receipt"]);assert.deepEqual(h.states.slice(0,3),["prepared","submitting","committed"]);
});
for(const tenderType of ["card","mobile_money"])test(tenderType+" is recorded without local hardware",async()=>{
  const h=harness({fetchImpl:async()=>({ok:true,json:async()=>({ok:true,data:{...receipt,tenderType,hardwareEnabled:false}})})});
  const ui=await initialized(h);await h.execute(()=>ui.submit({...payload,tenderType,paymentReference:"1234"}));
  assert.equal(h.latest().state,"committed");assert.deepEqual(h.hardware,[]);
});
test("double click and slow response do not create two requests",async()=>{
  let release;const gate=new Promise(r=>release=r);
  const h=harness({fetchImpl:async()=>{await gate;return {ok:true,json:async()=>({ok:true,data:receipt})};}});
  const ui=await initialized(h);
  await h.execute(async()=>{const first=ui.submit(payload);await new Promise(r=>setImmediate(r));await ui.submit(payload);assert.equal(h.requests.length,1);release();await first;});
});
test("connection loss preserves identity and restores an already committed sale without hardware",async()=>{
  const h=harness({fetchImpl:async()=>{throw Error("connection lost after commit");}});const ui=await initialized(h);
  await h.execute(()=>ui.submit(payload));const pending=h.read();
  assert.equal(pending.state,"outcome_unknown");assert.equal(pending.payload.idempotencyKey,h.requests[0].body.idempotencyKey);
  assert.deepEqual(h.hardware,[]);
  const reopened=harness({prior:pending,fetchImpl:async()=>({ok:true,json:async()=>({ok:true,outcome:"committed",data:receipt})})});
  const restored=await initialized(reopened);await reopened.execute(()=>restored.checkOutcome());
  assert.equal(reopened.latest().state,"committed");assert.deepEqual(reopened.hardware,[]);
  assert.ok(reopened.requests.every(r=>!r.body)); // lookup only, no sale POST
});
test("not-found recovery resubmits the same immutable payload/key and never automatically replays hardware",async()=>{
  const prior=newAttempt("cashier",payload);prior.state="outcome_unknown";let count=0;
  const h=harness({prior,fetchImpl:async()=>++count===1?{ok:true,json:async()=>({ok:true,outcome:"not_found"})}:{ok:true,json:async()=>({ok:true,data:receipt})}});
  const ui=await initialized(h);await h.execute(()=>ui.checkOutcome());await h.execute(()=>h.render().retryOriginal());
  assert.deepEqual(h.requests[1].body,payload);assert.equal(h.latest().state,"committed");assert.deepEqual(h.hardware,[]);
});
test("known rollback is rejected; transport failure before a response remains unknown",async()=>{
  const h=harness({fetchImpl:async()=>({ok:false,json:async()=>({ok:false,outcome:"rejected",message:"Stock validation"})})});
  const ui=await initialized(h);await h.execute(()=>ui.submit(payload));assert.equal(h.read().state,"rejected");assert.deepEqual(h.hardware,[]);
});
test("refresh converts interrupted submitting/hardware pending to unknown without reposting",async()=>{
  const prior=newAttempt("cashier",payload);prior.state="submitting";prior.hardware.drawer.state="pending";
  const h=harness({prior});await initialized(h);
  assert.equal(h.read().state,"outcome_unknown");assert.equal(h.read().hardware.drawer.state,"outcome_unknown");assert.equal(h.requests.length,0);
});
test("unresolved sale cannot be replaced; hardware failure leaves committed sale intact",async()=>{
  const prior=newAttempt("cashier",payload);prior.state="outcome_unknown";
  const h=harness({prior});const ui=await initialized(h);await h.execute(()=>ui.startNew());assert.equal(h.read().payload.idempotencyKey,payload.idempotencyKey);
  const second=harness({drawerState:"outcome_unknown"});const fresh=await initialized(second);await second.execute(()=>fresh.submit(payload));
  assert.equal(second.latest().state,"committed");assert.deepEqual(second.hardware,["drawer","receipt"]);
});
test("controlled reprint calls receipt only, never sale posting or drawer",async()=>{
  const prior=newAttempt("cashier",payload);prior.state="committed";prior.receipt=receipt;
  const h=harness({prior});const ui=await initialized(h);await h.execute(()=>ui.reprint(payload.idempotencyKey));
  assert.deepEqual(h.hardware,["receipt"]);assert.equal(h.requests.length,0);assert.notEqual(h.latest().hardware.receipt.requestId,"original");
});
test("payload snapshot is immutable and hashing preserves canonical item ordering",()=>{
  const input=structuredClone(payload),attempt=newAttempt("cashier",input);input.items[0].quantity=20;
  assert.equal(attempt.payload.items[0].quantity,1);
  assert.equal(hashableSale({...payload,items:[{menuItemId:2,quantity:1},...payload.items]}),hashableSale({...payload,items:[...payload.items,{menuItemId:2,quantity:1}]}));
});
test("new SQL wrapper delegates to original atomic RPC; lookup/reprint routes never call sale creation",()=>{
  const sql=fs.readFileSync("db/phase-100-pos-sale-recovery-receipt.sql","utf8");
  assert.match(sql,/from public\.create_pos_sale\(/);assert.match(sql,/revoke all[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(sql,/create or replace function public\.create_pos_sale\(/);
  for(const file of ["app/api/admin/pos/sales/[idempotencyKey]/route.ts","app/api/admin/pos/sales/[idempotencyKey]/hardware/route.ts","lib/pos/sale-server.ts"])
    assert.doesNotMatch(fs.readFileSync(file,"utf8"),/rpc\("create_pos_sale/);
});

test("sale API uses one atomic receipt RPC for cash/card/mobile money and preserves server totals",async()=>{
  for(const tenderType of ["cash","card","mobile_money"]){
    const calls=[];
    const actor={userId:"cashier",role:"cashier"};
    const schema=require("zod").z.object({idempotencyKey:require("zod").z.string().uuid(),tenderType:require("zod").z.enum(["cash","card","mobile_money"]),amountReceived:require("zod").z.number(),paymentReference:require("zod").z.string().optional(),items:require("zod").z.array(require("zod").z.object({menuItemId:require("zod").z.number(),quantity:require("zod").z.number()}))});
    const route=loadTs("app/api/admin/pos/sales/route.ts",{
      "next/server":{NextResponse:{json:(value,init)=>Response.json(value,init)}},
      "@/lib/auth/admin-role":{AdminAuthorizationError:class extends Error{},assertSameOriginRequest:()=>{},requirePosAccess:async()=>actor},
      "@/lib/schemas/admin":{posSaleRequestSchema:schema},
      "@/lib/supabase/server":{createAdminSupabaseClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{...receipt,tenderType,totalAmount:999},error:null};}})},
      "@/lib/validation/http":{RequestValidationError:class extends Error{},parseJsonBody:async(req,s)=>s.parse(await req.json())},
      "@/lib/request-limits":{RequestBodyTooLargeError:class extends Error{}},
      "@/lib/pos/sale-contract":{hashableSale},
      "@/lib/pos/sale-server":{decorateReceipt:v=>v},
      "@/lib/pos/hardware-bridge":{issueWalkInHardwareAction:async()=>null},
      "@/lib/pos/timing":{posTimer:()=>()=>{}}
    });
    const response=await route.POST(new Request("https://pos.test/api/admin/pos/sales",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...payload,tenderType,paymentReference:tenderType==="cash"?undefined:"1234"})}));
    assert.equal(response.status,200);assert.equal((await response.json()).data.totalAmount,999);
    assert.equal(calls.length,1);assert.equal(calls[0].name,"create_pos_sale_with_receipt");
    assert.equal(calls[0].args.p_idempotency_key,payload.idempotencyKey);assert.equal(calls[0].args.p_cashier_profile_id,"cashier");
  }
});
test("outcome lookup filters both request identity and original cashier",async()=>{
  const filters=[];
  const module=loadTs("lib/pos/sale-server.ts",{
    "server-only":{},
    "@/lib/pos/hardware-bridge":{isPosHardwareBridgeEnabled:()=>true},
    "@/lib/supabase/server":{createAdminSupabaseClient:()=>({
      from:(table)=>{assert.equal(table,"pos_sale_requests");const query={select:()=>query,eq:(k,v)=>{filters.push([k,v]);return query;},maybeSingle:async()=>({data:{order_id:1},error:null})};return query;},
      rpc:async(name,args)=>{assert.equal(name,"get_pos_sale_receipt");assert.equal(args.p_cashier_profile_id,"cashier");return {data:receipt,error:null};}
    })}
  });
  assert.equal((await module.findCashierSale(payload.idempotencyKey,"cashier")).orderId,1);
  assert.deepEqual(filters,[["idempotency_key",payload.idempotencyKey],["cashier_profile_id","cashier"]]);
});
test("hardware authorization rejects missing/non-cash sales and scopes receipt reprints without posting",async()=>{
  const z=require("zod").z;
  let sale=null;const signed=[];
  class AuthError extends Error{}
  const module=loadTs("app/api/admin/pos/sales/[idempotencyKey]/hardware/route.ts",{
    "next/server":{NextResponse:{json:(v,i)=>Response.json(v,i)}},
    "@/lib/auth/admin-role":{AdminAuthorizationError:AuthError,assertSameOriginRequest:()=>{},requirePosAccess:async()=>({userId:"cashier"})},
    "@/lib/pos/sale-server":{findCashierSale:async(key,owner)=>{assert.equal(key,payload.idempotencyKey);assert.equal(owner,"cashier");return sale;}},
    "@/lib/pos/hardware-bridge":{issueWalkInHardwareAction:async(...args)=>{signed.push(args);return {authorization:"test-only"};}},
    "@/lib/validation/http":{RequestValidationError:z.ZodError,parseJsonBody:async(req,s)=>s.parse(await req.json())},
    "@/lib/pos/timing":{posTimer:()=>()=>{}}
  });
  const call=(body)=>module.POST(new Request("https://pos.test/hardware",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({idempotencyKey:payload.idempotencyKey})});
  assert.equal((await call({kind:"drawer",requestId:"original"})).status,403);
  sale={...receipt,tenderType:"card"};assert.equal((await call({kind:"drawer",requestId:"original"})).status,403);
  sale=receipt;assert.equal((await call({kind:"drawer",requestId:crypto.randomUUID()})).status,400);
  const reprint=crypto.randomUUID();assert.equal((await call({kind:"receipt",requestId:reprint})).status,200);
  assert.equal(signed.length,1);assert.equal(signed[0][2],"receipt");assert.equal(signed[0][3],reprint);
});
test("hardware client treats lost acknowledgement as uncertain and authorization failure as unsent",async()=>{
  const module=loadTs("lib/pos/hardware-client.ts",{"./timing":{posTimer:()=>()=>{}}});
  const attempt=newAttempt("cashier",payload);attempt.state="committed";attempt.receipt=receipt;
  const original=globalThis.fetch;
  try{
    let count=0;
    globalThis.fetch=async()=>{if(++count===1)return {ok:true,json:async()=>({ok:true,data:{bridgeUrl:"http://127.0.0.1:1",authorization:"synthetic",actionId:"pos:1:drawer:original",saleId:"1001"}})};throw Error("lost acknowledgement");};
    assert.equal((await module.submitHardware(attempt,"drawer")).state,"outcome_unknown");
    globalThis.fetch=async()=>{throw Error("authorization offline");};
    assert.equal((await module.submitHardware(attempt,"drawer")).state,"failed");
  }finally{globalThis.fetch=original;}
});

test("fresh response-only hardware grants avoid another cloud call; aged grants refresh the same action",async()=>{
  const module=loadTs("lib/pos/hardware-client.ts",{"./timing":{posTimer:()=>()=>{}}});
  const attempt=newAttempt("cashier",payload);attempt.state="committed";attempt.receipt=receipt;
  const grant={bridgeUrl:"http://127.0.0.1:1",authorization:"synthetic-do-not-persist",actionId:"pos:1:drawer:original",saleId:"1001",receipt:receipt.canonicalReceipt,expiresAt:Date.now()+60000};
  const original=globalThis.fetch;const calls=[];
  try {
    globalThis.fetch=async(url)=>{calls.push(url);return {ok:true,json:async()=>({status:"submitted"})};};
    assert.equal((await module.submitHardware(attempt,"drawer",grant)).state,"submitted");
    assert.deepEqual(calls,["http://127.0.0.1:1/pos/drawer/open"]);
    calls.length=0;
    globalThis.fetch=async(url)=>{calls.push(url);return calls.length===1?{ok:true,json:async()=>({ok:true,data:grant})}:{ok:true,json:async()=>({status:"submitted"})};};
    assert.equal((await module.submitHardware(attempt,"drawer",{...grant,expiresAt:Date.now()})).state,"submitted");
    assert.match(calls[0],/\/hardware$/);assert.match(calls[1],/\/pos\/drawer\/open$/);
  }finally{globalThis.fetch=original;}
});
test("response-only tokens never enter the durable committed sale",async()=>{
  const h=harness({fetchImpl:async()=>({ok:true,json:async()=>({ok:true,data:receipt,hardware:{drawer:{authorization:"synthetic-do-not-persist"}}})})});
  const ui=await initialized(h);await h.execute(()=>ui.submit(payload));assert.doesNotMatch(JSON.stringify(h.latest()),/synthetic-do-not-persist/);
});

test("confirmed sale automatically releases entry; consecutive sales use distinct keys without a reset click",async()=>{
  const h=harness();const ui=await initialized(h);
  await h.execute(()=>ui.submit(payload));
  assert.equal(h.read(),null);assert.equal(h.committed.length,1);
  const firstKey=h.latest().payload.idempotencyKey;
  await h.execute(()=>h.render().submit(payload));
  assert.equal(h.read(),null);assert.notEqual(h.latest().payload.idempotencyKey,firstKey);
  assert.equal(h.requests.filter(r=>r.url==="/api/admin/pos/sales").length,2);
  assert.deepEqual(h.hardware,["drawer","receipt","drawer","receipt"]);
});
test("previously confirmed active sale moves to history on reopen without hardware replay",async()=>{
  const prior=newAttempt("cashier",payload);prior.state="committed";prior.receipt=receipt;prior.hardware.drawer.state="pending";
  const h=harness({prior});await initialized(h);
  assert.equal(h.read(),null);assert.equal(h.latest().hardware.drawer.state,"outcome_unknown");
  assert.deepEqual(h.hardware,[]);assert.equal(h.requests.length,0);
});
test("hardware uncertainty remains in history without requiring a manual next sale",async()=>{
  const h=harness({drawerState:"outcome_unknown"});const ui=await initialized(h);
  await h.execute(()=>ui.submit(payload));
  assert.equal(h.read(),null);assert.equal(h.latest().state,"committed");
  assert.equal(h.latest().hardware.drawer.state,"outcome_unknown");assert.equal(h.committed.length,1);
});
test("receipt-only history operations never activate an old sale or disturb a pending identity",async()=>{
  const historical=newAttempt("cashier",payload);historical.state="committed";historical.receipt=receipt;
  const pending=newAttempt("cashier",{...payload,idempotencyKey:"00000000-0000-4000-8000-000000000002"});pending.state="outcome_unknown";
  const h=harness({prior:pending,recordedAttempts:[historical]});const ui=await initialized(h);
  await h.execute(()=>ui.reprint(historical.payload.idempotencyKey));
  assert.equal(h.read().payload.idempotencyKey,pending.payload.idempotencyKey);
  assert.equal(h.read().state,"outcome_unknown");
  assert.deepEqual(h.hardware,["receipt"]);assert.equal(h.requests.length,0);
});
test("recorded-sales panel is collapsed by default and contains no next-sale gate",()=>{
  const React=require("react"),{renderToStaticMarkup}=require("react-dom/server");
  const {RecordedSales}=loadTs("components/pos/recorded-sales.tsx",{"@/lib/ops/utils":{formatCurrency:n=>"UGX "+n}});
  const a=newAttempt("cashier",payload);a.state="committed";a.receipt=receipt;
  const html=renderToStaticMarkup(React.createElement(RecordedSales,{attempts:[a],busy:false,onReprint(){},onCheckHardware(){}}));
  assert.match(html,/<summary[^>]*>Recent recorded sales on this browser/);
  assert.doesNotMatch(html,/<details[^>]*\bopen(?:\s|=|>)/);
  assert.doesNotMatch(html,/Start next sale/);
  assert.match(html,/Reprint recorded receipt only/);assert.match(html,/Sale 1001/);
});
