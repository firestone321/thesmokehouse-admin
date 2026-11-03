import {NextResponse} from "next/server";
import {z} from "zod";
import {assertSameOriginRequest} from "@/lib/auth/admin-role";
import {requireOfflineManager} from "@/lib/pos/offline-operations";
import {verifyOfflineEvidence} from "@/lib/pos/offline-ingestion";
import {createAdminSupabaseClient} from "@/lib/supabase/server";
export async function POST(request:Request){
 try{
 assertSameOriginRequest(request);const actor=await requireOfflineManager();
 const reader=request.body?.getReader();if(!reader)throw Error("Body required");let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)return NextResponse.json({error:"batch_too_large"},{status:413});chunks.push(value);}}finally{await reader.cancel();}
 const bytes=Buffer.concat(chunks).toString("utf8");
 const b=z.object({permitId:z.uuid(),sales:z.array(z.unknown()).min(1).max(100)}).strict().parse(JSON.parse(bytes)),db=createAdminSupabaseClient(),results=[];
 for(const raw of b.sales){try{
 const v=await verifyOfflineEvidence(raw);
 const {data:t,error:lookup}=await db.from("pos_offline_terminals").select("terminal_key").eq("terminal_id",v.envelope.terminalId).eq("epoch",v.envelope.epoch).maybeSingle();
 if(lookup||!t||t.terminal_key!==v.terminalKey)throw Error("terminal_binding_failed");
 const {data,error}=await db.rpc("import_pos_offline_recovery",{p_permit:b.permitId,p_envelope:v.envelope,p_signature:v.signature,p_hash:v.payloadHash,p_grant:v.grant,p_manager:actor.userId,p_decision:crypto.randomUUID()});
 if(error)throw Error(/offline_[a-z_]+/.exec(error.message)?.[0]||"recovery_archive_failed");
 results.push({transactionId:v.envelope.transactionId,accepted:true,acknowledgement:data});
 }catch(error){results.push({accepted:false,reason:(error as Error).message.match(/^[a-z_]+$/)?.[0]||"evidence_rejected"});}}
 return NextResponse.json({results},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"recovery_import_rejected"},{status:403});}
}
