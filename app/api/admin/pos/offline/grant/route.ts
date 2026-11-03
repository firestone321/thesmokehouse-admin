import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateJwkThumbprint, importJWK, jwtVerify, decodeJwt, decodeProtectedHeader } from "jose";
import { AdminAuthorizationError, assertSameOriginRequest, requirePosAccess } from "@/lib/auth/admin-role";
import { isLocalAuthBypassEnabled } from "@/lib/auth/local-bypass";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { offlinePosEnabled, signOfflineGrant, signJournalBinding } from "@/lib/pos/offline-grant";


export async function POST(request:Request) {
  const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
  if(!offlinePosEnabled()) return response({message:"Offline cash POS is disabled."},404);
  try {
    assertSameOriginRequest(request);
    if(await isLocalAuthBypassEnabled()) return response({message:"Real staff authentication required for offline authorization."},403);
    const actor=await requirePosAccess();
    const body=z.object({terminalId:z.uuid(),epoch:z.uuid(),publicJwk:z.object({kty:z.literal("OKP"),crv:z.literal("Ed25519"),x:z.string()}).strict(),nonce:z.uuid(),proof:z.string().max(4096)}).strict().parse(await request.json());
    const proof=await jwtVerify(body.proof,await importJWK(body.publicJwk,"EdDSA"),{algorithms:["EdDSA"],issuer:body.terminalId,audience:"smokehouse-offline-enrollment-v1",requiredClaims:["iat","exp"]});
    if(proof.payload.nonce!==body.nonce||proof.payload.epoch!==body.epoch||proof.payload.terminalId!==body.terminalId||
       proof.payload.exp!-proof.payload.iat!>60||proof.payload.iat!>Date.now()/1000+5)
      return response({message:"Invalid terminal enrollment proof."},403);
    const supabase=createAdminSupabaseClient();
    const {data:staff,error:staffError}=await supabase.auth.admin.getUserById(actor.userId);
    if(staffError||!staff.user||(staff.user.banned_until&&Date.parse(staff.user.banned_until)>Date.now()))
      return response({message:"Staff account cannot receive offline authorization."},403);
    const terminalKey=await calculateJwkThumbprint(body.publicJwk);
    let bindingReceipt:string|undefined;
    if(process.env.POS_OFFLINE_OPERATIONS_ENABLED==="true"){
      const {data:binding,error:bindingError}=await supabase.rpc("get_pos_offline_journal_binding",{p_terminal:body.terminalId,p_epoch:body.epoch,p_key:terminalKey});
      if(bindingError||!binding?.journalId||proof.payload.journalId!==binding.journalId||proof.payload.recoveryOnly===true||
         !Number.isSafeInteger(proof.payload.sequence)||Number(proof.payload.sequence)<Number(binding.minimumSequence))
        return response({message:"Manager enrollment of the original journal is required; use supervised recovery for a replacement."},409);
      bindingReceipt=await signJournalBinding(body.terminalId,body.epoch,binding.journalId,binding.managerId);
    }
    const {data,error}=await supabase.rpc("get_pos_offline_snapshot",{
      p_terminal_id:body.terminalId,p_epoch:body.epoch,p_terminal_key:terminalKey,p_cashier_id:actor.userId
    });
    if(error||!data) return response({message:"No current funded offline allocation is available for this registered terminal."},409);
    const token=await signOfflineGrant(data,actor.userId);
    if(process.env.POS_OFFLINE_OPERATIONS_ENABLED==="true"){const {error:issuanceError}=await supabase.rpc("record_pos_offline_grant_issuance",{p_grant:decodeJwt(token).grant,p_key_id:decodeProtectedHeader(token).kid});
      if(issuanceError)return response({message:"Offline authorization evidence could not be recorded."},503);}
    return response({token,bindingReceipt});
  } catch(error) {
    if(error instanceof AdminAuthorizationError)return response({message:error.message},error.status);
    if(error instanceof z.ZodError)return response({message:"Invalid terminal identity."},422);
    console.error("Offline grant preparation failed"); // No key, token, PIN or financial payload.
    return response({message:"Offline authorization could not be prepared."},503);
  }
}
