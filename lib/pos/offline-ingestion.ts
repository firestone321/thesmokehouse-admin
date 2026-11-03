import "server-only";
import { createHash, createPublicKey, createPrivateKey, verify } from "node:crypto";
import { calculateJwkThumbprint, importJWK, jwtVerify, errors as joseErrors, type JWK } from "jose";
import { z } from "zod";

const integer=z.number().int().positive().max(100_000_000);
const resource=z.object({resourceId:integer,quantity:integer}).strict();
const catalogItem=z.object({menuItemId:integer,name:z.string().min(1).max(120),unitPrice:integer,requirements:z.array(resource).min(1).max(30)}).strict();
const receiptItem=z.object({name:z.string().min(1).max(120),quantity:integer,unitPrice:integer,total:integer}).strict();
const receipt=z.object({saleId:z.string().min(1).max(100),date:z.iso.datetime(),items:z.array(receiptItem).min(1).max(100),subtotal:integer,total:integer,paymentMethod:z.literal("cash")}).strict();
export const envelopeSchema=z.object({
 version:z.literal(1),transactionId:z.uuid(),terminalId:z.uuid(),epoch:z.uuid(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
 cashierId:z.uuid(),grantId:z.uuid(),authorization:z.string().min(1).max(100_000),allocationId:z.uuid(),catalogVersion:z.uuid(),
 occurredAt:z.iso.datetime(),serviceDate:z.iso.date(),amountReceived:integer,changeGiven:z.number().int().min(0).max(100_000_000),
 items:z.array(catalogItem.extend({quantity:z.number().int().min(1).max(20),total:integer}).strict()).min(1).max(100),
 receipt,inputHash:z.string().regex(/^[A-Za-z0-9_-]{43}$/)
}).strict();
const grantSchema=z.object({
 version:z.literal(1),grantId:z.uuid(),terminalId:z.uuid(),epoch:z.uuid(),terminalKey:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
 cashierId:z.uuid(),permissions:z.array(z.enum(["cash","reprint"])).min(1),allocationId:z.uuid(),catalogVersion:z.uuid(),serviceDate:z.iso.date(),
 issuedAt:z.number().int().positive(),expiresAt:z.number().int().positive(),
 items:z.array(catalogItem).min(1).max(100),budgets:z.array(resource).min(1).max(100)
}).strict();
export const deliverySchema=z.object({
 envelope:envelopeSchema,signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/),
 publicJwk:z.object({kty:z.literal("OKP"),crv:z.literal("Ed25519"),x:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict()
}).strict();
export function canonical(value:unknown):string {
 if(value===null||typeof value!=="object")return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 return "{"+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
}
export function payloadHash(value:unknown) {return createHash("sha256").update(canonical(value)).digest("base64url");}
export class SyncValidationError extends Error {}
export class SyncAuthenticationRenewalError extends Error {}
export async function verifyOfflineDelivery(value:unknown,proof:string,now=Date.now()) {
 const body=deliverySchema.parse(value),e=body.envelope;
 const hash=payloadHash(e),terminalKey=await calculateJwkThumbprint(body.publicJwk);
 const key=await importJWK(body.publicJwk,"EdDSA");
 let request;
 try{request=await jwtVerify(proof,key,{algorithms:["EdDSA"],issuer:e.terminalId,audience:"smokehouse-offline-sync-v1",requiredClaims:["iat","exp"]});}
 catch(error){if(error instanceof joseErrors.JWTExpired)throw new SyncAuthenticationRenewalError("terminal_proof_expired");throw error;}
 if(request.payload.terminalId!==e.terminalId||request.payload.epoch!==e.epoch||request.payload.payloadHash!==hash)throw new SyncValidationError("terminal_proof_invalid");
 if(request.payload.exp!-request.payload.iat!>60||request.payload.iat!>now/1000+5)throw new SyncAuthenticationRenewalError("terminal_clock_or_proof_invalid");
 return verifyOfflineEvidence(body,now);
}
export async function verifyOfflineEvidence(value:unknown,now=Date.now()) {
 const body=deliverySchema.parse(value),e=body.envelope;
 const hash=payloadHash(e),terminalKey=await calculateJwkThumbprint(body.publicJwk);
 const key=await importJWK(body.publicJwk,"EdDSA");
 if(!verify(null,Buffer.from(canonical(e)),createPublicKey({key:body.publicJwk,format:"jwk"}),Buffer.from(body.signature,"base64url")))
   throw new SyncValidationError("sale_signature_invalid");
 const occurred=Date.parse(e.occurredAt);
 if(occurred>now+30_000||new Date(occurred+10_800_000).toISOString().slice(0,10)!==e.serviceDate)throw new SyncValidationError("capture_date_invalid");
 const encoded=process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64;
 const keys:JWK[]=[];
 if(encoded)keys.push(createPublicKey(createPrivateKey({key:JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")),format:"jwk"})).export({format:"jwk"}) as JWK);
 const history=process.env.POS_OFFLINE_GRANT_VERIFYING_JWKS_B64;
 if(history){const ring=JSON.parse(Buffer.from(history,"base64url").toString("utf8"));
   if(!Array.isArray(ring.keys)||ring.keys.length>64||ring.keys.some((k:JWK)=>k.kty!=="OKP"||k.crv!=="Ed25519"||k.d))throw Error("Invalid public verification key ring");keys.push(...ring.keys);}
 if(!keys.length||!process.env.POS_OFFLINE_GRANT_ISSUER)throw Error("Offline verification is not configured");
 let auth:{payload:import("jose").JWTPayload}|undefined,lastError:unknown;
 for(const candidate of keys){try{auth=await jwtVerify(e.authorization,await importJWK(candidate,"EdDSA"),{
   algorithms:["EdDSA"],issuer:process.env.POS_OFFLINE_GRANT_ISSUER,audience:"smokehouse-offline-pos-v1",currentDate:new Date(occurred),requiredClaims:["iat","exp"]
 });break;}catch(error){lastError=error;}}
 if(!auth)throw lastError;
 const grant=grantSchema.parse(auth.payload.grant);
 if(auth.payload.iat!*1000!==grant.issuedAt||auth.payload.exp!*1000!==grant.expiresAt||
   grant.issuedAt>occurred||grant.expiresAt<=occurred||grant.expiresAt-grant.issuedAt>43_200_000||
   !grant.permissions.includes("cash")||grant.terminalKey!==terminalKey||
   ["terminalId","epoch","cashierId","grantId","allocationId","catalogVersion","serviceDate"].some(k=>Reflect.get(grant,k)!==Reflect.get(e,k)))
   throw new SyncValidationError("capture_authorization_invalid");
 const total=e.items.reduce((n,i)=>n+i.total,0);
 if(new Set(e.items.map(i=>i.menuItemId)).size!==e.items.length||
    e.items.some(i=>i.total!==i.quantity*i.unitPrice||!grant.items.some(g=>g.menuItemId===i.menuItemId&&g.name===i.name&&g.unitPrice===i.unitPrice&&canonical(g.requirements)===canonical(i.requirements)))||
    total!==e.receipt.total||total!==e.receipt.subtotal||e.amountReceived<total||e.changeGiven!==e.amountReceived-total||
    e.receipt.date!==e.occurredAt||canonical(e.receipt.items)!==canonical(e.items.map(({name,quantity,unitPrice,total})=>({name,quantity,unitPrice,total}))))
   throw new SyncValidationError("historical_sale_invalid");
 const input={transactionId:e.transactionId,catalogVersion:e.catalogVersion,expectedTotal:total,amountReceived:e.amountReceived,
   items:e.items.map(({menuItemId,quantity})=>({menuItemId,quantity})).sort((a,b)=>a.menuItemId-b.menuItemId)};
 if(payloadHash(input)!==e.inputHash)throw new SyncValidationError("input_hash_invalid");
 const reference="L-"+e.terminalId.slice(0,8)+"-"+e.epoch.slice(0,8)+"-"+String(e.sequence).padStart(6,"0");
 if(e.receipt.saleId!==reference)throw new SyncValidationError("receipt_identity_invalid");
 return {...body,grant,payloadHash:hash,terminalKey};
}
