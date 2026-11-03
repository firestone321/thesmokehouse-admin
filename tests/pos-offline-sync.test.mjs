import assert from "node:assert/strict";
import test from "node:test";
import {loadTs} from "./pos-test-loader.mjs";
const validation=loadTs("lib/pos/offline-ingestion.ts",{"server-only":{}});
function route(){
 let calls=0;
 const {POST}=loadTs("app/api/admin/pos/offline/ingest/route.ts",{
   "next/server":{NextResponse:{json:(body,init)=>Response.json(body,init)}},
   "@/lib/supabase/server":{createAdminSupabaseClient(){calls++;throw Error("Never connect to Supabase");}},
   "@/lib/pos/offline-ingestion":validation
 });
 return {POST,get calls(){return calls;}};
}
async function configured(value,work){
 const prior=process.env.POS_OFFLINE_SYNC_ENABLED;
 try{if(value===undefined)delete process.env.POS_OFFLINE_SYNC_ENABLED;else process.env.POS_OFFLINE_SYNC_ENABLED=value;await work();}
 finally{if(prior===undefined)delete process.env.POS_OFFLINE_SYNC_ENABLED;else process.env.POS_OFFLINE_SYNC_ENABLED=prior;}
}
test("automatic ingestion is disabled by default without touching database",()=>configured(undefined,async()=>{
 const r=route(),response=await r.POST(new Request("https://admin.test/api/admin/pos/offline/ingest",{method:"POST"}));
 assert.equal(response.status,503);assert.equal(r.calls,0);
}));
test("browser staff cookies cannot replace a terminal signature proof",()=>configured("true",async()=>{
 const r=route(),response=await r.POST(new Request("https://admin.test/api/admin/pos/offline/ingest",{method:"POST",headers:{cookie:"staff-session=fake"},body:"{}"}));
 assert.equal(response.status,401);assert.equal(r.calls,0);
}));
test("oversized or malformed deliveries fail before any financial RPC",()=>configured("true",async()=>{
 const r=route();
 for(const body of [" ".repeat(512001),"{"]){
  const response=await r.POST(new Request("https://admin.test/api/admin/pos/offline/ingest",{method:"POST",headers:{Authorization:"Bearer fake.proof.value"},body}));
  assert.equal(response.status,422);
 }
 assert.equal(r.calls,0);
}));
