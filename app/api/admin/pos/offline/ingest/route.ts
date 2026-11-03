import { NextResponse } from "next/server";
import { z } from "zod";
import { errors as joseErrors } from "jose";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { verifyOfflineDelivery, SyncValidationError, SyncAuthenticationRenewalError } from "@/lib/pos/offline-ingestion";
export const runtime="nodejs";
export const maxDuration=30;
const MAX_BYTES=512_000;
async function readBounded(request:Request) {
 const reader=request.body?.getReader();if(!reader)throw new SyncValidationError("body_required");
 let length=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES)throw new SyncValidationError("body_too_large");chunks.push(value);}}
 finally{await reader.cancel();}
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function POST(request:Request) {
 const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
 if(process.env.POS_OFFLINE_SYNC_ENABLED!=="true")return respond({error:{code:"sync_disabled"}},503);
 try {
   const proof=request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]{1,4096})$/)?.[1];
   if(!proof)return respond({error:{code:"terminal_auth_required"}},401);
   const delivery=await verifyOfflineDelivery(await readBounded(request),proof);
   const db=createAdminSupabaseClient(),e=delivery.envelope;
   const {data:terminal,error:lookup}=await db.from("pos_offline_terminals").select("terminal_key").eq("terminal_id",e.terminalId).eq("epoch",e.epoch).maybeSingle();
   if(lookup)return respond({error:{code:"registration_lookup_unavailable"}},503);
   if(!terminal||terminal.terminal_key!==delivery.terminalKey)return respond({error:{code:"terminal_not_registered"}},403);
   const {data,error}=await db.rpc("ingest_pos_offline_cash_sale",{
     p_envelope:e,p_signature:delivery.signature,p_payload_hash:delivery.payloadHash,p_grant:delivery.grant
   });
   if(error) {
     const permanent=error.code==="23505"||/^offline_(identity_conflict|invalid_|receipt_|capture_|allocation_|historical_|duplicate_|tender_|payload_|unactivated_)/.test(error.message);
     if(permanent&&process.env.POS_OFFLINE_OPERATIONS_ENABLED==="true"){
       const archived=await db.rpc("archive_pos_offline_conflict",{p_envelope:e,p_signature:delivery.signature,p_hash:delivery.payloadHash,p_grant:delivery.grant,p_reason:error.message});
       if(archived.error)return respond({error:{code:"conflict_archive_unavailable"}},503);
     }
     return respond({error:{code:permanent?"ingestion_conflict":"ingestion_unavailable"}},permanent?409:503);
   }
   if(!data)return respond({error:{code:"acknowledgement_unavailable"}},503);
   return respond({acknowledgement:data});
 }catch(error) {
   if(error instanceof SyncAuthenticationRenewalError)return respond({error:{code:"terminal_proof_renewal_required"}},401);
   if(error instanceof z.ZodError||error instanceof SyntaxError||error instanceof SyncValidationError)return respond({error:{code:"invalid_offline_delivery"}},422);
   if(error instanceof joseErrors.JOSEError)return respond({error:{code:"authorization_invalid"}},403);
   console.error("Offline ingestion unavailable"); // Never log financial envelopes, tokens or keys.
   return respond({error:{code:"ingestion_unavailable"}},503);
 }
}
