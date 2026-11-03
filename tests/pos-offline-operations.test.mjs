import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {generateKeyPairSync,randomUUID,sign} from "node:crypto";
import {SignJWT} from "jose";
import {loadTs} from "./pos-test-loader.mjs";
test("offline manager operations require live manager identity and reject bypass/disabled accounts",async()=>{
 const prior=process.env.POS_OFFLINE_OPERATIONS_ENABLED;process.env.POS_OFFLINE_OPERATIONS_ENABLED="true";
 let role="cashier",bypass=false,banned=false;
 class AuthError extends Error{constructor(message,status){super(message);this.status=status;}}
 const fakeDb={auth:{admin:{getUserById:async()=>({data:{user:{id:"actor",banned_until:banned?new Date(Date.now()+3600000).toISOString():null}},error:null})}}};
 const h=loadTs("lib/pos/offline-operations.ts",{
 "server-only":{},"@/lib/auth/admin-role":{AdminAuthorizationError:AuthError,requireDashboardRole:async()=>({userId:"actor",role}),canApproveOperationalChanges:r=>["manager","admin"].includes(r)},
 "@/lib/auth/local-bypass":{isLocalAuthBypassEnabled:async()=>bypass},"@/lib/supabase/server":{createAdminSupabaseClient:()=>fakeDb}
 });
 try{
 await assert.rejects(h.requireOfflineManager(),e=>e.status===403);role="manager";assert.equal((await h.requireOfflineManager()).role,"manager");
 bypass=true;await assert.rejects(h.requireOfflineManager(),/Real manager/);bypass=false;banned=true;await assert.rejects(h.requireOfflineManager(),/Active manager/);
 delete process.env.POS_OFFLINE_OPERATIONS_ENABLED;await assert.rejects(h.requireOfflineManager(),/disabled/);
 }finally{if(prior===undefined)delete process.env.POS_OFFLINE_OPERATIONS_ENABLED;else process.env.POS_OFFLINE_OPERATIONS_ENABLED=prior;}
});
test("terminal operations proof binds body, epoch, audience and signature; a browser ID is insufficient",async()=>{
 const validation=loadTs("lib/pos/offline-ingestion.ts",{"server-only":{}});
 const h=loadTs("lib/pos/offline-terminal-messages.ts",{"server-only":{},"./offline-ingestion":validation,"./offline-operations":{publicKeySchema:validation.deliverySchema.shape.publicJwk}});
 const pair=generateKeyPairSync("ed25519"),terminalId=randomUUID(),epoch=randomUUID();
 const body={version:1,type:"report",terminalId,epoch,sequence:0,reportId:randomUUID(),reportedAt:new Date().toISOString(),status:{pending_count:0},allocations:[]};
 const signature=sign(null,Buffer.from(validation.canonical(body)),pair.privateKey).toString("base64url"),delivery={body,signature,publicJwk:pair.publicKey.export({format:"jwk"})};
 const proof=aud=>new SignJWT({terminalId,epoch,payloadHash:validation.payloadHash(body)}).setProtectedHeader({alg:"EdDSA"}).setIssuer(terminalId).setAudience(aud).setIssuedAt().setExpirationTime("60s").sign(pair.privateKey);
 assert.equal((await h.verifyOperationsDelivery(delivery,await proof("smokehouse-offline-operations-v1"))).body.terminalId,terminalId);
 await assert.rejects(h.verifyOperationsDelivery({...delivery,body:{...body,sequence:1}},await proof("smokehouse-offline-operations-v1")));
 await assert.rejects(h.verifyOperationsDelivery(delivery,await proof("smokehouse-offline-sync-v1")));
 await assert.rejects(h.verifyOperationsDelivery({...delivery,signature:"x".repeat(86)},await proof("smokehouse-offline-operations-v1")));
});

test("every manager mutation rejects unauthenticated actors before accessing financial RPCs",async()=>{
 let calls=0;
 const h=loadTs("lib/pos/offline-operations-actions.ts",{
  "next/navigation":{redirect(){throw Error("unexpected redirect");}},"next/cache":{revalidatePath(){}},
  "@/lib/supabase/server":{createAdminSupabaseClient(){calls++;throw Error("unexpected database access");}},
  "@/lib/pos/offline-operations":{requireOfflineManager:async()=>{throw Error("Manager authentication denied");}}
 });
 for(const action of Object.values(h))await assert.rejects(action(new FormData()),/Manager authentication denied/);
 assert.equal(calls,0);
});
test("fresh terminal enrollment binds the original journal and rejects nonempty/recovery enrollment",async()=>{
 const h=loadTs("lib/pos/offline-operations.ts",{"server-only":{},"@/lib/auth/admin-role":{},"@/lib/auth/local-bypass":{},"@/lib/supabase/server":{}});
 const pair=generateKeyPairSync("ed25519"),terminalId=randomUUID(),epoch=randomUUID(),nonce=randomUUID(),journalId=randomUUID(),publicJwk=pair.publicKey.export({format:"jwk"});
 async function proof(sequence=0,recoveryOnly=false){return new SignJWT({terminalId,epoch,nonce,journalId,sequence,recoveryOnly,legacyUpgrade:sequence>0})
 .setProtectedHeader({alg:"EdDSA"}).setIssuer(terminalId).setAudience("smokehouse-offline-enrollment-v1").setIssuedAt().setExpirationTime("60s").sign(pair.privateKey);}
 const input={terminalId,epoch,nonce,publicJwk,proof:await proof()};
 assert.equal((await h.verifyEnrollment(input)).journalId,journalId);
 await assert.rejects(h.verifyEnrollment({...input,proof:await proof(3)}),/original empty journal/);
 assert.equal((await h.verifyEnrollment({...input,proof:await proof(3)},true)).sequence,3);
 await assert.rejects(h.verifyEnrollment({...input,proof:await proof(3,true)},true),/supervised legacy/);
 await assert.rejects(h.verifyEnrollment({...input,nonce:randomUUID()}),/Invalid enrollment proof/);
});

test("operational endpoint rejects a different journal identity before accepting a signed report",async()=>{
 const before=process.env.POS_OFFLINE_OPERATIONS_ENABLED;process.env.POS_OFFLINE_OPERATIONS_ENABLED="true";
 try{
 const validation=loadTs("lib/pos/offline-ingestion.ts",{"server-only":{}});
 const operations=loadTs("lib/pos/offline-terminal-messages.ts",{"server-only":{},"./offline-ingestion":validation,"./offline-operations":{publicKeySchema:validation.deliverySchema.shape.publicJwk}});
 const pair=generateKeyPairSync("ed25519"),publicJwk=pair.publicKey.export({format:"jwk"}),terminalId=randomUUID(),epoch=randomUUID(),journalId=randomUUID();
 const {calculateJwkThumbprint}=await import("jose");const terminalKey=await calculateJwkThumbprint(publicJwk);let rpcCalls=0;
 const db={from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:{terminal_key:terminalKey,journal_id:journalId},error:null};}};},async rpc(){rpcCalls++;return {data:{control:{revision:0,suspended:false,revoked:false},resolutions:[]},error:null};}};
 const {POST}=loadTs("app/api/admin/pos/offline/operations/route.ts",{
  "next/server":{NextResponse:{json:(body,init)=>Response.json(body,init)}},
  "@/lib/supabase/server":{createAdminSupabaseClient:()=>db},"@/lib/pos/offline-terminal-messages":operations,"@/lib/pos/offline-replenishment":{}
 });
 async function send(jid){const body={version:1,type:"report",reportId:randomUUID(),terminalId,epoch,sequence:0,reportedAt:new Date().toISOString(),journalId:jid,status:{pending_count:0},allocations:[]};
 const proof=await new SignJWT({terminalId,epoch,payloadHash:validation.payloadHash(body)}).setProtectedHeader({alg:"EdDSA"}).setIssuer(terminalId).setAudience("smokehouse-offline-operations-v1").setIssuedAt().setExpirationTime("60s").sign(pair.privateKey);
 return POST(new Request("https://admin.test/api/admin/pos/offline/operations",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+proof},body:JSON.stringify({body,publicJwk,signature:sign(null,Buffer.from(validation.canonical(body)),pair.privateKey).toString("base64url")})}));}
 assert.equal((await send(randomUUID())).status,409);assert.equal(rpcCalls,0);
 assert.equal((await send(journalId)).status,200);assert.equal(rpcCalls,1);
 }finally{if(before===undefined)delete process.env.POS_OFFLINE_OPERATIONS_ENABLED;else process.env.POS_OFFLINE_OPERATIONS_ENABLED=before;}
});
