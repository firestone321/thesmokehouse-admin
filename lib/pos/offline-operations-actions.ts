"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {createAdminSupabaseClient} from "@/lib/supabase/server";
import {requireOfflineManager,verifyEnrollment,publicKeySchema} from "@/lib/pos/offline-operations";
import {calculateJwkThumbprint,createLocalJWKSet,jwtVerify,type JWK} from "jose";
const id=(f:FormData,k:string)=>z.uuid().parse(f.get(k));
const reason=(f:FormData)=>z.string().trim().min(10).max(2000).parse(f.get("reason"));
function result(error:{message:string}|null){revalidatePath("/pos/offline-operations");redirect("/pos/offline-operations?message="+encodeURIComponent(error?(/offline_[a-z_]+/.exec(error.message)?.[0]||"Operation was blocked; original evidence is preserved."):"Recorded with immutable audit evidence."));}
export async function offlineDecisionAction(f:FormData){
 const actor=await requireOfflineManager(),action=z.enum(["confirm_genuine","flag_duplicate","review_evidence","confirmed_duplicate","resolve_late","close_incident","handover_review"]).parse(f.get("action"));
 const {error}=await createAdminSupabaseClient().rpc("decide_pos_offline_record",{p_decision:id(f,"decisionId"),p_transaction:id(f,"transactionId"),p_manager:actor.userId,p_action:action,p_reason:reason(f),p_reference_order:f.get("referenceOrder")?z.coerce.number().int().positive().parse(f.get("referenceOrder")):null});result(error);
}
export async function offlineTerminalAction(f:FormData){
 const actor=await requireOfflineManager();const {error}=await createAdminSupabaseClient().rpc("manage_pos_offline_terminal",{p_manager:actor.userId,p_terminal:id(f,"terminalId"),p_epoch:id(f,"epoch"),p_action:z.enum(["suspend","resume","revoke","prepare_replacement","handover"]).parse(f.get("action")),p_reason:reason(f),p_decision:id(f,"decisionId")});result(error);
}
export async function offlineEnrollAction(f:FormData){
 const actor=await requireOfflineManager(),terminalId=id(f,"terminalId"),epoch=id(f,"epoch");
 const key=await verifyEnrollment({terminalId,epoch,nonce:id(f,"nonce"),publicJwk:JSON.parse(z.string().max(2000).parse(f.get("publicJwk"))),proof:z.string().max(4096).parse(f.get("proof"))});
 const {error}=await createAdminSupabaseClient().rpc("enroll_bound_pos_offline_terminal",{p_terminal:terminalId,p_epoch:epoch,p_key:key.terminalKey,p_journal:key.journalId,p_manager:actor.userId,p_reason:reason(f),p_decision:id(f,"decisionId")});result(error);
}
export async function offlineReturnAction(f:FormData){
 const actor=await requireOfflineManager();const {error}=await createAdminSupabaseClient().rpc("return_pos_offline_unused",{p_manager:actor.userId,p_allocation:id(f,"allocationId"),p_reason:reason(f),p_decision:id(f,"decisionId")});result(error);
}
export async function offlineFundAction(f:FormData){
 const actor=await requireOfflineManager(),minutes=z.coerce.number().int().min(1).max(720).parse(f.get("minutes"));
 const now=Date.now(),day=new Date(now+10800000).toISOString().slice(0,10),end=Date.parse(day+"T21:00:00.000Z");
 const {error}=await createAdminSupabaseClient().rpc("fund_manager_pos_allocation",{p_id:crypto.randomUUID(),p_terminal:id(f,"terminalId"),p_epoch:id(f,"epoch"),p_catalog:crypto.randomUUID(),
 p_items:z.array(z.coerce.number().int().positive()).min(1).max(100).parse(f.getAll("items").flatMap(v=>String(v).split(",")).map(s=>s.trim())),
 p_budgets:String(f.get("budgets")||"").trim()?JSON.parse(String(f.get("budgets"))):null,p_expires:new Date(Math.min(now+minutes*60000,end-1000)).toISOString(),
 p_manager:actor.userId,p_reason:reason(f),p_decision:id(f,"decisionId")});result(error);
}
export async function offlineLookupAction(f:FormData){
 const actor=await requireOfflineManager(),{data,error}=await createAdminSupabaseClient().rpc("lookup_pos_offline_transaction",{p_actor:actor.userId,p_id:id(f,"transactionId")});
 if(error)result(error);redirect("/pos/offline-operations?message="+encodeURIComponent(JSON.stringify(data)));
}

export async function offlineRecoveryPermitAction(f:FormData){
 const actor=await requireOfflineManager(),permit=id(f,"decisionId");
 const {error}=await createAdminSupabaseClient().rpc("issue_pos_offline_recovery",{p_id:permit,p_terminal:id(f,"terminalId"),p_epoch:id(f,"epoch"),p_hash:z.string().regex(/^[a-f0-9]{64}$/).parse(f.get("backupHash")),p_manager:actor.userId,p_reason:reason(f)});
 if(error)result(error);redirect("/pos/offline-operations?recoveryPermit="+permit);
}
export async function offlineKeyRotationAction(f:FormData){
 const actor=await requireOfflineManager(),ring=z.object({keys:z.array(publicKeySchema).min(1).max(64)}).strict().parse(JSON.parse(String(f.get("publicHistory"))));
 const {createPrivateKey,createPublicKey}=await import("node:crypto");
 const required:import("jose").JWK[]=[];
 const current=process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64;
 if(current)required.push(createPublicKey(createPrivateKey({key:JSON.parse(Buffer.from(current,"base64url").toString("utf8")),format:"jwk"})).export({format:"jwk"}) as import("jose").JWK);
 const history=process.env.POS_OFFLINE_GRANT_VERIFYING_JWKS_B64;
 if(history)required.push(...JSON.parse(Buffer.from(history,"base64url").toString("utf8")).keys);
 const supplied=new Set(await Promise.all(ring.keys.map(k=>calculateJwkThumbprint(k))));
 for(const k of required)if(!supplied.has(await calculateJwkThumbprint(k)))throw Error("Retain all currently trusted historical keys; unresolved offline evidence must remain verifiable.");
 const {error}=await createAdminSupabaseClient().rpc("audit_pos_offline_key_rotation",{p_id:id(f,"decisionId"),p_manager:actor.userId,p_reason:reason(f),p_public_keys:ring.keys});result(error);
}

export async function offlineConflictReviewAction(f:FormData){
 const actor=await requireOfflineManager();const {error}=await createAdminSupabaseClient().rpc("review_pos_offline_conflict",{p_case:id(f,"evidenceId"),p_manager:actor.userId,p_reason:reason(f),p_decision:id(f,"decisionId")});result(error);
}

export async function offlineBindJournalAction(f:FormData){
 const actor=await requireOfflineManager(),terminalId=id(f,"terminalId"),epoch=id(f,"epoch");
 const key=await verifyEnrollment({terminalId,epoch,nonce:id(f,"nonce"),publicJwk:JSON.parse(z.string().max(2000).parse(f.get("publicJwk"))),proof:z.string().max(4096).parse(f.get("proof"))},true);
 const {error}=await createAdminSupabaseClient().rpc("bind_existing_pos_offline_journal",{p_terminal:terminalId,p_epoch:epoch,p_key:key.terminalKey,p_journal:key.journalId,p_sequence:key.sequence,p_legacy_upgrade:key.legacyUpgrade,p_manager:actor.userId,p_reason:reason(f),p_decision:id(f,"decisionId")});result(error);
}

export async function offlineReplenishmentPolicyAction(f:FormData){
 const actor=await requireOfflineManager();if(process.env.POS_OFFLINE_REPLENISHMENT_ENABLED!=="true")throw Error("Replenishment management disabled");
 const resources=z.array(z.number().int().positive()).min(1).max(100).parse(JSON.parse(String(f.get("resources"))));
 const limits=resources.map(resourceId=>({resourceId,maxTarget:z.coerce.number().int().positive().parse(f.get("target_"+resourceId)),
 triggerPercent:z.coerce.number().int().min(1).max(99).parse(f.get("trigger_"+resourceId)),
 warnPercent:z.coerce.number().int().min(1).max(99).parse(f.get("warn_"+resourceId)),
 maxTopup:z.coerce.number().int().positive().parse(f.get("maximum_"+resourceId)),
 approvalAbove:z.coerce.number().int().min(0).parse(f.get("approval_"+resourceId))}));
 const {error}=await createAdminSupabaseClient().rpc("configure_pos_replenishment",{p_id:id(f,"decisionId"),p_allocation:id(f,"allocationId"),p_enabled:f.get("enabled")==="on",p_limits:limits,p_manager:actor.userId,p_reason:reason(f)});result(error);
}
export async function offlineManagerReplenishAction(f:FormData){
 const actor=await requireOfflineManager();if(process.env.POS_OFFLINE_REPLENISHMENT_ENABLED!=="true"||process.env.POS_OFFLINE_SYNC_ENABLED!=="true")throw Error("Connected replenishment and synchronization must be enabled");
 const db=createAdminSupabaseClient(),terminal=id(f,"terminalId"),epoch=id(f,"epoch");
 const {data,error:lookup}=await db.from("pos_offline_terminals").select("journal_id").eq("terminal_id",terminal).eq("epoch",epoch).single();
 if(lookup||!data?.journal_id)throw Error("Original journal enrollment required");
 const {error}=await db.rpc("request_pos_replenishment",{p_id:id(f,"decisionId"),p_allocation:id(f,"allocationId"),p_terminal:terminal,p_epoch:epoch,p_journal:data.journal_id,p_manager:actor.userId,p_reason:reason(f)});result(error);
}
