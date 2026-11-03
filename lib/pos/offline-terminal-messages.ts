import "server-only";
import {z} from "zod";
import {verify,createPublicKey} from "node:crypto";
import {jwtVerify,importJWK,calculateJwkThumbprint} from "jose";
import {canonical,payloadHash} from "./offline-ingestion";
import {publicKeySchema} from "./offline-operations";
const integer=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),id=z.uuid();
const resource=z.object({resourceId:integer.positive(),quantity:integer}).strict();
const manifest=z.object({transactionId:id,sequence:integer.positive(),payloadHash:z.string().regex(/^[A-Za-z0-9_-]{43}$/),allocationId:id,resources:z.array(resource).max(100)}).strict();
const common={version:z.literal(1),terminalId:id,epoch:id,sequence:integer,journalId:id.optional()};
export const operationsDeliverySchema=z.object({
 publicJwk:publicKeySchema,signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/),
 body:z.discriminatedUnion("type",[
 z.object({...common,type:z.literal("report"),reportId:id,reportedAt:z.iso.datetime(),status:z.record(z.string(),z.unknown()),allocations:z.array(z.object({allocationId:id,resourceId:integer.positive(),remaining:integer}).strict()).max(10000)}).strict(),
 z.object({...common,type:z.literal("replenish"),journalId:id,requestId:id,allocationId:id}).strict(),
 z.object({...common,type:z.literal("replenishment_ack"),journalId:id,replenishmentId:id,allocationId:id,receiptHash:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict(),
 z.object({...common,type:z.literal("closure"),allocationId:id,closedAt:z.iso.datetime(),manifest:z.array(manifest).max(10000),unused:z.array(resource).max(100),fundingReceipts:z.array(z.object({id,receiptHash:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict()).max(10000).optional()}).strict()
 ])
}).strict();
export async function verifyOperationsDelivery(value:unknown,proof:string){
 const parsed=operationsDeliverySchema.parse(value),b=parsed.body,key=await importJWK(parsed.publicJwk,"EdDSA"),hash=payloadHash(b);
 const {payload}=await jwtVerify(proof,key,{algorithms:["EdDSA"],issuer:b.terminalId,audience:"smokehouse-offline-operations-v1",requiredClaims:["iat","exp"]});
 if(payload.terminalId!==b.terminalId||payload.epoch!==b.epoch||payload.payloadHash!==hash||payload.exp!-payload.iat!>60||payload.iat!>Date.now()/1000+5)throw Error("Invalid operational proof");
 if(!verify(null,Buffer.from(canonical(b)),createPublicKey({key:parsed.publicJwk,format:"jwk"}),Buffer.from(parsed.signature,"base64url")))throw Error("Invalid terminal signature");
 return {...parsed,payloadHash:hash,terminalKey:await calculateJwkThumbprint(parsed.publicJwk)};
}
