import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { generateKeyPairSync,randomUUID } from "node:crypto";
import { jwtVerify,importJWK } from "jose";
import { loadTs } from "./pos-test-loader.mjs";
const {offlinePosEnabled,signOfflineGrant}=loadTs("lib/pos/offline-grant.ts",{"server-only":{}});
test("offline grant issuance is disabled by default",async()=>{
 const old=process.env.POS_OFFLINE_ENABLED;
 try{delete process.env.POS_OFFLINE_ENABLED;assert.equal(offlinePosEnabled(),false);await assert.rejects(signOfflineGrant({},"cashier"),/disabled/);}
 finally{if(old===undefined)delete process.env.POS_OFFLINE_ENABLED;else process.env.POS_OFFLINE_ENABLED=old;}
});
test("server signs a bounded, cashier-bound offline catalog with independent audience",async()=>{
 const names=["POS_OFFLINE_ENABLED","POS_OFFLINE_GRANT_PRIVATE_JWK_B64","POS_OFFLINE_GRANT_ISSUER"];
 const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
  const pair=generateKeyPairSync("ed25519"),now=Date.UTC(2026,9,29,10),cashierId=randomUUID();
  process.env.POS_OFFLINE_ENABLED="true";process.env.POS_OFFLINE_GRANT_ISSUER="offline-test";
  process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64=Buffer.from(JSON.stringify(pair.privateKey.export({format:"jwk"}))).toString("base64url");
  const snapshot={terminalId:randomUUID(),epoch:randomUUID(),terminalKey:"x".repeat(43),allocationId:randomUUID(),catalogVersion:randomUUID(),
   serviceDate:"2026-10-29",expiresAt:now+20*60*60*1000,
   items:[{menuItemId:1,name:"Water",unitPrice:2000,requirements:[{resourceId:1,quantity:1}]}],budgets:[{resourceId:1,quantity:2}]};
  const token=await signOfflineGrant(snapshot,cashierId,now);
  const verified=await jwtVerify(token,await importJWK(pair.publicKey.export({format:"jwk"}),"EdDSA"),{issuer:"offline-test",audience:"smokehouse-offline-pos-v1",currentDate:new Date(now)});
  assert.equal(verified.payload.grant.cashierId,cashierId);assert.equal(verified.payload.grant.terminalId,snapshot.terminalId);
  assert.equal(verified.payload.exp*1000,now+12*60*60*1000);
  assert.equal(verified.payload.grant.items[0].unitPrice,2000);
  await assert.rejects(signOfflineGrant({...snapshot,expiresAt:now-1},cashierId,now),/expired/);
 }finally{for(const n of names){if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];}}
});
test("offline grant route is gated, requires live staff auth, and cannot mint its own allocation",async()=>{
 let databaseCalls=0;
 const {POST}=loadTs("app/api/admin/pos/offline/grant/route.ts",{
  "next/server":{NextResponse:{json:(body,init)=>({body,...init})}},
  "@/lib/auth/admin-role":{AdminAuthorizationError:class extends Error{},assertSameOriginRequest(){},requirePosAccess:async()=>{throw Error("Must not authenticate when disabled");}},
  "@/lib/auth/local-bypass":{isLocalAuthBypassEnabled:async()=>false},
  "@/lib/supabase/server":{createAdminSupabaseClient(){databaseCalls++;throw Error("No DB");}},
  "@/lib/pos/offline-grant":{offlinePosEnabled:()=>false}
 });
 const response=await POST(new Request("https://admin.test/api/admin/pos/offline/grant",{method:"POST"}));
 assert.equal(response.status,404);assert.equal(databaseCalls,0);
 const source=fs.readFileSync("app/api/admin/pos/offline/grant/route.ts","utf8");
 assert.match(source,/isLocalAuthBypassEnabled/);assert.match(source,/banned_until/);assert.match(source,/get_pos_offline_snapshot/);
 assert.doesNotMatch(source,/fund_pos_offline_allocation|create_pos_sale/);
});
test("offline migration holds physical and daily stock atomically, remains service-only, and does not change Phase 2 RPCs",()=>{
 const sql=fs.readFileSync("db/phase-103-offline-pos-foundations.sql","utf8");
 assert.match(sql,/for update/);assert.match(sql,/ceil\(v_available::numeric\*0\.35\)/);assert.match(sql,/allocation_minimum_35_percent/);assert.match(sql,/current_quantity=current_quantity-v_resource.quantity/);
 assert.match(sql,/reserved_quantity=reserved_quantity\+v_resource.quantity/);
 assert.match(sql,/revoke all[\s\S]*from public,anon,authenticated/);
 assert.doesNotMatch(sql,/create or replace function public.create_pos_sale|drop function|delete from public.orders/i);
 const page=fs.readFileSync("app/(admin)/pos/page.tsx","utf8");assert.match(page,/offlinePosEnabled\(\)/);
 assert.match(page,/<PosSaleWorkspace/);
});

test("grant endpoint verifies terminal key possession and binds the live cashier to the funded snapshot",async()=>{
 const {SignJWT,importJWK}=await import("jose");
 const pair=generateKeyPairSync("ed25519"),publicJwk=pair.publicKey.export({format:"jwk"});
 const terminalId=randomUUID(),epoch=randomUUID(),cashierId=randomUUID(),nonce=randomUUID();
 const proof=await new SignJWT({terminalId,epoch,nonce}).setProtectedHeader({alg:"EdDSA"}).setIssuer(terminalId)
  .setAudience("smokehouse-offline-enrollment-v1").setIssuedAt().setExpirationTime("60s")
  .sign(await importJWK(pair.privateKey.export({format:"jwk"}),"EdDSA"));
 let rpcCalls=0,banned=false,signedCashier;
 const snapshot={allocationId:randomUUID()};
 const {POST}=loadTs("app/api/admin/pos/offline/grant/route.ts",{
  "next/server":{NextResponse:{json:(body,init)=>({body,...init})}},
  "@/lib/auth/admin-role":{AdminAuthorizationError:class extends Error{},assertSameOriginRequest(){},requirePosAccess:async()=>({userId:cashierId})},
  "@/lib/auth/local-bypass":{isLocalAuthBypassEnabled:async()=>false},
  "@/lib/supabase/server":{createAdminSupabaseClient:()=>({
   auth:{admin:{getUserById:async()=>({data:{user:{banned_until:banned?new Date(Date.now()+60000).toISOString():null}},error:null})}},
   rpc:async(name,args)=>{rpcCalls++;assert.equal(name,"get_pos_offline_snapshot");assert.equal(args.p_cashier_id,cashierId);assert.equal(args.p_terminal_id,terminalId);return {data:snapshot,error:null};}
  })},
  "@/lib/pos/offline-grant":{offlinePosEnabled:()=>true,signOfflineGrant:async(data,id)=>{assert.deepEqual(data,snapshot);signedCashier=id;return "synthetic-grant";}}
 });
 const req=body=>new Request("https://admin.test/api/admin/pos/offline/grant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const body={terminalId,epoch,publicJwk,nonce,proof};
 const valid=await POST(req(body));assert.equal(valid.status,200);assert.equal(valid.body.token,"synthetic-grant");assert.equal(signedCashier,cashierId);
 const changed=await POST(req({...body,nonce:randomUUID()}));assert.equal(changed.status,403);assert.equal(rpcCalls,1);
 banned=true;const disabled=await POST(req(body));assert.equal(disabled.status,403);assert.equal(rpcCalls,1);
});
