import "server-only";
import {requireDashboardRole,canApproveOperationalChanges,AdminAuthorizationError} from "@/lib/auth/admin-role";
import {isLocalAuthBypassEnabled} from "@/lib/auth/local-bypass";
import {createAdminSupabaseClient} from "@/lib/supabase/server";
import {calculateJwkThumbprint,importJWK,jwtVerify,SignJWT,type JWK} from "jose";
import {z} from "zod";
export async function requireOfflineManager(){
 if(process.env.POS_OFFLINE_OPERATIONS_ENABLED!=="true")throw new AdminAuthorizationError("Offline operations are disabled.",403);
 if(await isLocalAuthBypassEnabled())throw new AdminAuthorizationError("Real manager authentication is required.",403);
 const actor=await requireDashboardRole();if(!canApproveOperationalChanges(actor.role))throw new AdminAuthorizationError("Manager access required.",403);
 const {data,error}=await createAdminSupabaseClient().auth.admin.getUserById(actor.userId);
 if(error||!data.user||(data.user.banned_until&&Date.parse(data.user.banned_until)>Date.now()))throw new AdminAuthorizationError("Active manager required.",403);
 return actor;
}
export const publicKeySchema=z.object({kty:z.literal("OKP"),crv:z.literal("Ed25519"),x:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
export async function verifyEnrollment(input:{terminalId:string;epoch:string;nonce:string;publicJwk:unknown;proof:string},allowExisting=false){
 const key=publicKeySchema.parse(input.publicJwk),id=z.uuid().parse(input.terminalId),epoch=z.uuid().parse(input.epoch);
 const {payload}=await jwtVerify(input.proof,await importJWK(key,"EdDSA"),{algorithms:["EdDSA"],issuer:id,audience:"smokehouse-offline-enrollment-v1",requiredClaims:["iat","exp"]});
 if(payload.epoch!==epoch||payload.terminalId!==id||payload.nonce!==z.uuid().parse(input.nonce)||payload.exp!-payload.iat!>60||payload.iat!>Date.now()/1000+5)throw Error("Invalid enrollment proof");
 const sequence=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(payload.sequence);
 if(payload.recoveryOnly===true||(!allowExisting&&sequence!==0))throw Error("Use the original empty journal or supervised legacy binding.");
 return {terminalKey:await calculateJwkThumbprint(key),journalId:z.uuid().parse(payload.journalId),sequence,legacyUpgrade:payload.legacyUpgrade===true};
}
export async function signManagementPermit(terminalId:string,epoch:string,allocationId:string,managerId:string){
 const encoded=process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64,issuer=process.env.POS_OFFLINE_GRANT_ISSUER;if(!encoded||!issuer)throw Error("Management signing configuration missing");
 return new SignJWT({operation:{action:"close-allocation",terminalId,epoch,allocationId,managerId,nonce:crypto.randomUUID()}})
 .setProtectedHeader({alg:"EdDSA"}).setIssuer(issuer).setAudience("smokehouse-offline-management-v1").setIssuedAt().setExpirationTime("5m")
 .sign(await importJWK(JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")) as JWK,"EdDSA"));
}

export async function signRecoveryPermit(row:Record<string,any>){
 const encoded=process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64,issuer=process.env.POS_OFFLINE_GRANT_ISSUER;
 if(!encoded||!issuer)throw Error("Recovery signing configuration missing");
 const issued=Math.floor(Date.parse(row.issued_at)/1000);if(issued+86400<=Date.now()/1000)throw Error("Recovery permit expired");
 return new SignJWT({recovery:{permitId:row.id,terminalId:row.terminal_id,epoch:row.epoch,backupHash:row.backup_hash,minimumSequence:Number(row.minimum_sequence),mode:"evidence-only",fenced:true}})
 .setProtectedHeader({alg:"EdDSA"}).setIssuer(issuer).setAudience("smokehouse-offline-recovery-v1").setIssuedAt(issued).setExpirationTime(issued+86400)
 .sign(await importJWK(JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")),"EdDSA"));
}
