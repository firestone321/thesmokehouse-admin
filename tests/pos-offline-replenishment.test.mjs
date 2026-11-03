import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,generateKeyPairSync,sign} from "node:crypto";
import {SignJWT,jwtVerify,calculateJwkThumbprint} from "jose";
import {loadTs} from "./pos-test-loader.mjs";
test("signed funding is permanent evidence with an independent audience, never a replacement cashier grant",async()=>{
 const names=["POS_OFFLINE_GRANT_PRIVATE_JWK_B64","POS_OFFLINE_GRANT_ISSUER"],prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{
 const pair=generateKeyPairSync("ed25519");process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64=Buffer.from(JSON.stringify(pair.privateKey.export({format:"jwk"}))).toString("base64url");process.env.POS_OFFLINE_GRANT_ISSUER="funding-test";
 const {signFundingRecord}=loadTs("lib/pos/offline-replenishment.ts",{"server-only":{}}),record={id:randomUUID(),resources:[{resourceId:1,quantity:6}]};
 const token=await signFundingRecord("funding",record);
 const verified=await jwtVerify(token,pair.publicKey,{issuer:"funding-test",audience:"smokehouse-offline-replenishment-v1"});
 assert.deepEqual(verified.payload.funding,record);assert.equal(verified.payload.grant,undefined);
 await assert.rejects(jwtVerify(token,pair.publicKey,{audience:"smokehouse-offline-pos-v1"}));
 const active=await signFundingRecord("activation",{id:record.id,receiptHash:"h".repeat(43)});
 assert.ok((await jwtVerify(active,pair.publicKey,{audience:"smokehouse-offline-replenishment-activation-v1"})).payload.activation);
 }finally{for(const n of names)if(prior[n]===undefined)delete process.env[n];else process.env[n]=prior[n];}
});
test("replenishment endpoint gates funding and binds a real terminal proof to its registered journal",async()=>{
 const names=["POS_OFFLINE_OPERATIONS_ENABLED","POS_OFFLINE_REPLENISHMENT_ENABLED","POS_OFFLINE_SYNC_ENABLED"],prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{
 process.env.POS_OFFLINE_SYNC_ENABLED="true";process.env.POS_OFFLINE_OPERATIONS_ENABLED="true";delete process.env.POS_OFFLINE_REPLENISHMENT_ENABLED;
 const validation=loadTs("lib/pos/offline-ingestion.ts",{"server-only":{}});
 const ops=loadTs("lib/pos/offline-terminal-messages.ts",{"server-only":{},"./offline-ingestion":validation,"./offline-operations":{publicKeySchema:validation.deliverySchema.shape.publicJwk}});
 const key=generateKeyPairSync("ed25519"),publicJwk=key.publicKey.export({format:"jwk"}),terminalId=randomUUID(),epoch=randomUUID(),journalId=randomUUID(),allocationId=randomUUID();
 const terminalKey=await calculateJwkThumbprint(publicJwk);let calls=0,args;
 const db={from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:{terminal_key:terminalKey,journal_id:journalId},error:null};}};},async rpc(name,value){assert.equal(name,"request_pos_replenishment");calls++;args=value;return {data:{id:value.p_id,resources:[]},error:null};}};
 const {POST}=loadTs("app/api/admin/pos/offline/operations/route.ts",{
 "next/server":{NextResponse:{json:(body,init)=>Response.json(body,init)}},
 "@/lib/supabase/server":{createAdminSupabaseClient:()=>db},"@/lib/pos/offline-terminal-messages":ops,
 "@/lib/pos/offline-replenishment":{signFundingRecord:async()=> "signed-server-evidence"}
 });
 async function request(jid=journalId,extra={}){
 const body={version:1,type:"replenish",terminalId,epoch,journalId:jid,allocationId,sequence:4,requestId:randomUUID(),...extra};
 const proof=await new SignJWT({terminalId,epoch,payloadHash:validation.payloadHash(body)}).setProtectedHeader({alg:"EdDSA"}).setIssuer(terminalId).setAudience("smokehouse-offline-operations-v1").setIssuedAt().setExpirationTime("60s").sign(key.privateKey);
 return POST(new Request("https://admin.test/api/admin/pos/offline/operations",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+proof},body:JSON.stringify({body,publicJwk,signature:sign(null,Buffer.from(validation.canonical(body)),key.privateKey).toString("base64url")})}));
 }
 assert.equal((await request()).status,503);assert.equal(calls,0);
 process.env.POS_OFFLINE_REPLENISHMENT_ENABLED="true";
 assert.equal((await request(randomUUID())).status,409);assert.equal(calls,0);
 assert.equal((await request(journalId,{quantity:100000})).status,422);assert.equal(calls,0);
 const result=await request();assert.equal(result.status,200);assert.equal(calls,1);assert.equal(args.p_manager,null);assert.equal(args.p_journal,journalId);assert.equal("quantity" in args,false);
 const browser=await POST(new Request("https://admin.test/api/admin/pos/offline/operations",{method:"POST",body:"{}"}));assert.equal(browser.status,401);assert.equal(calls,1);
 }finally{for(const n of names)if(prior[n]===undefined)delete process.env[n];else process.env[n]=prior[n];}
});
