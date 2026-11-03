import "server-only";
import {createHash,createPrivateKey,createPublicKey,randomUUID} from "node:crypto";
import {SignJWT,importJWK} from "jose";
import {z} from "zod";
import {AdminAuthorizationError,requireApprovedAdminRole} from "@/lib/auth/admin-role";
import {isLocalAuthBypassEnabled} from "@/lib/auth/local-bypass";
import {createAdminSupabaseClient,createServerSupabaseClient} from "@/lib/supabase/server";
import {verifyEnrollment,publicKeySchema} from "@/lib/pos/offline-operations";
import {getOrdersPageData} from "@/lib/ops/queries";
import {ordersSnapshotSchema,sanitizeOrders,snapshotLimit} from "./offline-contract";
export const snapshotRequestSchema=z.object({terminalId:z.uuid(),epoch:z.uuid(),publicJwk:publicKeySchema,nonce:z.uuid(),proof:z.string().max(4096),sessionKey:z.uuid()}).strict();
export async function createOrdersSnapshot(value:unknown){
 if(process.env.OFFLINE_ORDERS_ENABLED!=="true")throw new AdminAuthorizationError("Offline Orders is disabled.",403);
 if(await isLocalAuthBypassEnabled())throw new AdminAuthorizationError("Real Orders authentication required.",403);
 const actor=await requireApprovedAdminRole(),input=snapshotRequestSchema.parse(value);
 const authSessionHash=await offlineOrdersSessionHash(actor.userId);
 const db=createAdminSupabaseClient(),{data:staff,error:staffError}=await db.auth.admin.getUserById(actor.userId);
 if(staffError)throw Error("Staff verification unavailable");if(!staff.user||(staff.user.banned_until&&Date.parse(staff.user.banned_until)>Date.now()))throw new AdminAuthorizationError("Staff authorization revoked.",403);
 let identity;try{identity=await verifyEnrollment(input,true);}catch{throw new AdminAuthorizationError("Invalid terminal identity.",403);}
 const {data:binding,error:bindingError}=await db.rpc("get_pos_offline_journal_binding",{p_terminal:input.terminalId,p_epoch:input.epoch,p_key:identity.terminalKey});
 if(bindingError)throw Error("Terminal verification unavailable");if(!binding?.journalId||binding.journalId!==identity.journalId||identity.sequence<Number(binding.minimumSequence))throw new AdminAuthorizationError("Terminal authorization unavailable.",403);
 const {data:control,error:controlError}=await db.from("pos_offline_controls").select("revoked,suspended").eq("terminal_id",input.terminalId).eq("epoch",input.epoch).maybeSingle();
 if(controlError)throw Error("Terminal controls unavailable");if(control?.revoked||control?.suspended)throw new AdminAuthorizationError("Terminal authorization revoked.",403);
 const {data:issuance,error:issuanceError}=await db.from("pos_offline_grant_issuances").select("grant_body").eq("cashier_id",actor.userId).eq("terminal_id",input.terminalId).eq("epoch",input.epoch).order("issued_at",{ascending:false}).limit(1).maybeSingle();
 if(issuanceError)throw Error("Offline authorization verification unavailable");const grant=issuance?.grant_body;
 if(!grant||grant.cashierId!==actor.userId||!Number.isSafeInteger(grant.expiresAt)||grant.expiresAt<=Date.now())throw new AdminAuthorizationError("Current local cashier authorization required.",403);
 const limit=snapshotLimit(process.env.OFFLINE_ORDERS_SNAPSHOT_LIMIT||200),boundary=new Date().toISOString();
 const pages=await Promise.all(Array.from({length:Math.ceil(limit/30)},(_,i)=>getOrdersPageData({status:"all",search:"",limit:30,page:i+1,createdAtLt:boundary})));const raw=pages.flatMap(p=>p.orders);
 let origins:Record<string,string>={};if(raw.length){const {data,error}=await db.from("pos_offline_ingestions").select("order_id,transaction_id").in("order_id",raw.map(o=>o.id));if(error)throw Error("Order identity reconciliation unavailable");origins=Object.fromEntries((data||[]).map(row=>[String(row.order_id),row.transaction_id]));}
 const now=Math.floor(Date.now()/1000)*1000,lease=Number(process.env.OFFLINE_ORDERS_LEASE_SECONDS||43200);
 if(!Number.isInteger(lease)||lease<60||lease>43200)throw Error("Invalid offline Orders lease duration");
 const snapshot=ordersSnapshotSchema.parse({version:1,snapshotId:randomUUID(),userId:actor.userId,role:actor.role,terminalId:input.terminalId,epoch:input.epoch,journalId:identity.journalId,sessionKey:input.sessionKey,authSessionHash,createdAt:now,expiresAt:Math.min(Math.floor(grant.expiresAt/1000)*1000,now+lease*1000),limit,orders:sanitizeOrders(raw,limit,origins)});
 const encoded=process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64,issuer=process.env.POS_OFFLINE_GRANT_ISSUER;if(!encoded||!issuer)throw Error("Offline Orders signing unavailable");const jwk=JSON.parse(Buffer.from(encoded,"base64url").toString());if(jwk.kty!=="OKP"||jwk.crv!=="Ed25519"||!jwk.d)throw Error("Invalid signing configuration");
 const publicJwk=createPublicKey(createPrivateKey({key:jwk,format:"jwk"})).export({format:"jwk"});const token=await new SignJWT({snapshot}).setProtectedHeader({alg:"EdDSA"}).setIssuer(issuer).setAudience("smokehouse-offline-orders-v1").setIssuedAt(now/1000).setExpirationTime(snapshot.expiresAt/1000).sign(await importJWK(jwk,"EdDSA"));
 return {token,publicJwk,issuer};
}

export async function offlineOrdersSessionHash(userId:string){
 const auth=await createServerSupabaseClient();const {data,error}=await auth.auth.getClaims();const sid=data?.claims?.session_id;
 if(error||data?.claims?.sub!==userId||typeof sid!=="string"||!z.uuid().safeParse(sid).success)throw new AdminAuthorizationError("A verified staff session is required.",403);
 return createHash("sha256").update(userId+":"+sid).digest("hex");
}
