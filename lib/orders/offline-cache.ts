"use client";
import {z} from "zod";
import {importJWK,jwtVerify} from "jose";
import {ordersSnapshotSchema,type OrdersSnapshot} from "./offline-contract";
const DB="smokehouse-admin-readonly-snapshots-v1",STORE="orders",POINTER="smokehouse-offline-orders-context-v1",EPOCH="smokehouse-offline-orders-invalidation-v1";
const keySchema=z.object({kty:z.literal("OKP"),crv:z.literal("Ed25519"),x:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
const contextSchema=z.object({bridgeUrl:z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/),userId:z.uuid(),terminalId:z.uuid(),epoch:z.uuid(),journalId:z.uuid(),sessionKey:z.uuid(),authSessionHash:z.string().regex(/^[a-f0-9]{64}$/),recordId:z.uuid(),expiresAt:z.number().int().positive(),issuer:z.string().min(1),publicJwk:keySchema}).strict();
export type OrdersContext=z.infer<typeof contextSchema>;
export type SnapshotBundle={token:string;issuer:string;publicJwk:z.infer<typeof keySchema>};
export function ordersContext():OrdersContext|null{try{const raw=sessionStorage.getItem(POINTER);if(!raw||raw.length>4000)return null;return contextSchema.parse(JSON.parse(raw));}catch{return null;}}
export function invalidationEpoch(){return localStorage.getItem(EPOCH)||"";}
function openDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:"id"});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error("Read-only snapshot storage unavailable"));r.onblocked=()=>reject(Error("Snapshot storage is busy"));});}
async function transaction<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore,done:(v:T)=>void)=>void){const db=await openDB();try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction(STORE,mode);let value:T;tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(Error("Read-only snapshot storage failed"));work(tx.objectStore(STORE),v=>value=v);});}finally{db.close();}}
export function invalidateOrdersSnapshots(){
 sessionStorage.removeItem(POINTER);const stamp=crypto.randomUUID();localStorage.setItem(EPOCH,stamp);window.dispatchEvent(new Event(EPOCH));const channel=new BroadcastChannel(EPOCH);channel.postMessage(stamp);channel.close();
 return transaction<void>("readwrite",(store,done)=>{store.clear();done();}).catch(()=>{});
}
export function watchOrdersInvalidation(clear:()=>void){const channel=new BroadcastChannel(EPOCH);const reset=()=>{sessionStorage.removeItem(POINTER);clear();};channel.onmessage=reset;const storage=(e:StorageEvent)=>{if(e.key===EPOCH)reset();};window.addEventListener("storage",storage);window.addEventListener(EPOCH,reset);return ()=>{channel.close();window.removeEventListener("storage",storage);window.removeEventListener(EPOCH,reset);};}
export async function verifyOrdersBundle(bundle:SnapshotBundle,expected:{userId:string;terminalId:string;epoch:string;journalId:string;sessionKey:string},now=Date.now()):Promise<OrdersSnapshot>{
 if(bundle.token.length>4000000)throw Error("Snapshot is too large");const {payload}=await jwtVerify(bundle.token,await importJWK(keySchema.parse(bundle.publicJwk),"EdDSA"),{issuer:bundle.issuer,audience:"smokehouse-offline-orders-v1",algorithms:["EdDSA"],currentDate:new Date(now),requiredClaims:["iat","exp"]});const snapshot=ordersSnapshotSchema.parse(payload.snapshot);
 if(snapshot.expiresAt<=now||snapshot.createdAt>now+5000||payload.exp!*1000!==snapshot.expiresAt||payload.iat!*1000!==snapshot.createdAt||Object.entries(expected).some(([k,v])=>Reflect.get(snapshot,k)!==v))throw Error("Snapshot identity or authorization mismatch");return snapshot;
}
export async function saveOrdersSnapshot(bundle:SnapshotBundle,expected:{userId:string;terminalId:string;epoch:string;journalId:string;sessionKey:string},generation:string,bridgeUrl:string){
 const snapshot=await verifyOrdersBundle(bundle,expected);if(invalidationEpoch()!==generation)throw Error("Orders session changed");const old=ordersContext();if(old&&(old.userId!==snapshot.userId||old.authSessionHash!==snapshot.authSessionHash||old.terminalId!==snapshot.terminalId||old.epoch!==snapshot.epoch))await invalidateOrdersSnapshots();
 if(invalidationEpoch()!==generation)throw Error("Orders session changed; prepare again");
 const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]),iv=crypto.getRandomValues(new Uint8Array(12));const encoded=new TextEncoder().encode(JSON.stringify(bundle));const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoded);const context=contextSchema.parse({...expected,bridgeUrl,authSessionHash:snapshot.authSessionHash,recordId:snapshot.snapshotId,expiresAt:snapshot.expiresAt,issuer:bundle.issuer,publicJwk:bundle.publicJwk});
 await transaction<void>("readwrite",(store,done)=>{const all=store.getAll();all.onsuccess=()=>{const others=all.result.filter((r:any)=>r.id!==old?.recordId&&r.expiresAt>Date.now()).sort((a:any,b:any)=>b.expiresAt-a.expiresAt);for(const record of all.result)if(record.id===old?.recordId||!others.slice(0,7).some((r:any)=>r.id===record.id))store.delete(record.id);if(invalidationEpoch()!==generation){store.transaction.abort();return;}store.put({id:context.recordId,expiresAt:context.expiresAt,key,iv:iv.buffer,cipher});done();};});
 if(invalidationEpoch()!==generation){await invalidateOrdersSnapshots();throw Error("Orders session changed");}sessionStorage.setItem(POINTER,JSON.stringify(context));return snapshot;
}
export async function readOrdersSnapshot(expected:{userId:string;terminalId:string;epoch:string;journalId:string},now=Date.now()){
 const context=ordersContext();if(!context||context.expiresAt<=now||Object.entries(expected).some(([k,v])=>Reflect.get(context,k)!==v))throw Error("No authorized snapshot for this session and terminal");const generation=invalidationEpoch();
 const record=await transaction<any>("readonly",(store,done)=>{const r=store.get(context.recordId);r.onsuccess=()=>done(r.result);});if(!record)throw Error("Snapshot missing");
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:record.iv},record.key,record.cipher);const bundle=JSON.parse(new TextDecoder().decode(plain)) as SnapshotBundle;if(bundle.issuer!==context.issuer||JSON.stringify(keySchema.parse(bundle.publicJwk))!==JSON.stringify(context.publicJwk))throw Error("Snapshot trust context changed");const snapshot=await verifyOrdersBundle(bundle,{...expected,sessionKey:context.sessionKey},now);
 if(snapshot.authSessionHash!==context.authSessionHash||snapshot.snapshotId!==context.recordId||invalidationEpoch()!==generation)throw Error("Snapshot session changed");return snapshot;
}
