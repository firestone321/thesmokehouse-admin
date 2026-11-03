import {signFundingRecord} from "@/lib/pos/offline-replenishment";
import {NextResponse} from "next/server";
import {errors} from "jose";
import {createAdminSupabaseClient} from "@/lib/supabase/server";
import {verifyOperationsDelivery} from "@/lib/pos/offline-terminal-messages";
export const runtime="nodejs";
export async function POST(request:Request){
 const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
 if(process.env.POS_OFFLINE_OPERATIONS_ENABLED!=="true")return response({error:"operations_disabled"},503);
 try{
 const reader=request.body?.getReader();if(!reader)return response({error:"body_required"},422);
 let bytes=0;const parts:Uint8Array[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2_000_000)return response({error:"body_too_large"},413);parts.push(value);}}finally{await reader.cancel();}
 const proof=request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]{1,4096})$/)?.[1];if(!proof)return response({error:"terminal_proof_required"},401);
 const v=await verifyOperationsDelivery(JSON.parse(Buffer.concat(parts).toString("utf8")),proof),b=v.body,db=createAdminSupabaseClient();
 const {data:t,error:lookup}=await db.from("pos_offline_terminals").select("terminal_key,journal_id").eq("terminal_id",b.terminalId).eq("epoch",b.epoch).maybeSingle();
 if(lookup)return response({error:"registration_unavailable"},503);if(!t||t.terminal_key!==v.terminalKey)return response({error:"terminal_not_registered"},403);
 if(t.journal_id&&b.journalId!==t.journal_id)return response({error:"original_journal_binding_required"},409);
 if(b.type==="report"){
 const {data,error}=await db.rpc("record_pos_offline_terminal_report",{p_body:b,p_signature:v.signature});
 if(error)return response({error:"report_unavailable"},503);
 let replenishmentState:unknown;
 if(process.env.POS_OFFLINE_REPLENISHMENT_ENABLED==="true"){
 const state=await db.rpc("get_pos_replenishment_state",{p_terminal:b.terminalId,p_epoch:b.epoch,p_journal:b.journalId});
 if(state.error)return response({error:"replenishment_state_unavailable"},503);
 replenishmentState=await Promise.all((state.data||[]).map(async(s:Record<string,any>)=>({...s,receipts:await Promise.all((s.receipts||[]).map((r:Record<string,unknown>)=>signFundingRecord("funding",r)))})));
 }
 return response({terminalId:b.terminalId,epoch:b.epoch,requestHash:v.payloadHash,...data,replenishmentState});
 }

 if(b.type==="replenish"||b.type==="replenishment_ack"){
  if(process.env.POS_OFFLINE_REPLENISHMENT_ENABLED!=="true")return response({error:"replenishment_disabled"},503);
  if(b.type==="replenish"&&process.env.POS_OFFLINE_SYNC_ENABLED!=="true")return response({error:"synchronization_disabled"},503);
  const result=b.type==="replenish"?await db.rpc("request_pos_replenishment",{p_id:b.requestId,p_allocation:b.allocationId,p_terminal:b.terminalId,p_epoch:b.epoch,p_journal:b.journalId,p_manager:null,p_reason:null})
   :await db.rpc("ack_pos_replenishment",{p_body:b,p_signature:v.signature});
  if(result.error||!result.data)return response({error:"replenishment_unavailable"},503);
  const kind=b.type==="replenish"?"funding":"activation";
  return response({terminalId:b.terminalId,epoch:b.epoch,requestHash:v.payloadHash,token:await signFundingRecord(kind,result.data)});
 }

 const {error}=await db.rpc("record_pos_offline_closure",{p_body:b,p_signature:v.signature,p_hash:v.payloadHash});
 if(error)return response({error:/offline_[a-z_]+/.exec(error.message)?.[0]||"closure_unavailable"},error.message.includes("offline_")?409:503);
 return response({terminalId:b.terminalId,epoch:b.epoch,requestHash:v.payloadHash,allocationId:b.allocationId,accepted:true});
 }catch(error){return response({error:"operational_evidence_rejected"},error instanceof errors.JWTExpired?401:422);}
}
