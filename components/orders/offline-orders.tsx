"use client";
import {useEffect,useRef,useState} from "react";
import {loginLocal,type LocalSession} from "@/lib/pos/local-bridge";
import {readOrdersBridge} from "@/lib/orders/offline-bridge";
import {ordersContext,invalidationEpoch,invalidateOrdersSnapshots,watchOrdersInvalidation,readOrdersSnapshot,saveOrdersSnapshot,type SnapshotBundle} from "@/lib/orders/offline-cache";
import {filterCachedOrders,presentCachedOrder,presentLocalSale,splitCloudAndLocal,type OrdersSnapshot} from "@/lib/orders/offline-contract";
import {OrdersHeader} from "./orders-header";
import {OrdersResults} from "./orders-results";
import {formatDateTime} from "@/lib/ops/utils";
type BridgeState=Awaited<ReturnType<typeof readOrdersBridge>>;
function Banner({text}:{text:string}){const [dismissed,setDismissed]=useState(false);useEffect(()=>setDismissed(false),[text]);return dismissed?null:<p role="status" className="my-2 flex items-start justify-between gap-2 text-xs text-[#4B5563]">{text}<button type="button" aria-label="Dismiss information" onClick={()=>setDismissed(true)}>×</button></p>;}
class AuthorizationDenied extends Error{}
export function OfflineOrders({userId,bridgeUrl,readOnly=false}:{userId:string;bridgeUrl:string;readOnly?:boolean}){
 const [pin,setPin]=useState(""),[session,setSession]=useState<LocalSession|null>(null),[snapshot,setSnapshot]=useState<OrdersSnapshot|null>(null),[bridge,setBridge]=useState<BridgeState|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const [status,setStatus]=useState("all"),[search,setSearch]=useState(""),[page,setPage]=useState(1);const runId=useRef(0),running=useRef(false),lastCloudTry=useRef(0);
 useEffect(()=>{const params=new URLSearchParams(location.search);setStatus(params.get("status")||"all");setSearch(params.get("search")||"");setPage(Math.max(1,Number(params.get("page"))||1));},[]);
 useEffect(()=>{const reset=()=>{runId.current++;setSnapshot(null);setBridge(null);setSession(null);setMessage("Orders session changed. Reconnect and authorize this user again.");};const ctx=ordersContext();if(ctx&&(ctx.userId!==userId||ctx.bridgeUrl!==bridgeUrl||ctx.expiresAt<=Date.now()))void invalidateOrdersSnapshots();const stop=watchOrdersInvalidation(reset);return ()=>{runId.current++;stop();};},[userId,bridgeUrl]);
 useEffect(()=>{if(!snapshot)return;const timer=setTimeout(()=>{setSnapshot(null);setBridge(null);void invalidateOrdersSnapshots();},Math.max(0,snapshot.expiresAt-Date.now()));return ()=>clearTimeout(timer);},[snapshot?.expiresAt]);
 const current=(id:number,stamp:string)=>id===runId.current&&invalidationEpoch()===stamp;
 async function refreshSnapshot(local:LocalSession,state:BridgeState,id:number,stamp:string){
   lastCloudTry.current=Date.now();const nonce=crypto.randomUUID(),ctx=ordersContext(),sessionKey=ctx?.sessionKey||crypto.randomUUID();const info=await fetch(bridgeUrl+"/offline/info?nonce="+nonce,{cache:"no-store",signal:AbortSignal.timeout(5000)});if(!info.ok)throw Error("Terminal proof unavailable");const proof=await info.json();
   const response=await fetch("/api/admin/orders/offline-snapshot",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({terminalId:local.terminalId,epoch:local.epoch,publicJwk:proof.publicJwk,nonce,proof:proof.proof,sessionKey}),signal:AbortSignal.timeout(8000)});
   if(response.status===401||response.status===403){if(current(id,stamp))await invalidateOrdersSnapshots();throw new AuthorizationDenied("Offline Orders authorization was denied. Cached data has been invalidated.");}
   if(!response.ok)throw Error("Cloud snapshot refresh unavailable");const bundle=await response.json() as SnapshotBundle;if(!current(id,stamp))return;

   const fresh=await saveOrdersSnapshot(bundle,{userId,terminalId:local.terminalId,epoch:local.epoch,journalId:state.journalId,sessionKey},stamp,bridgeUrl);
   if(current(id,stamp)){setSnapshot(fresh);setMessage("Read-only Orders snapshot updated.");}
 }
 async function authorize(){if(running.current)return;running.current=true;setBusy(true);setMessage("");const id=runId.current,stamp=invalidationEpoch();try{
   const local=await loginLocal(bridgeUrl,userId,pin);setPin("");const state=await readOrdersBridge(local);if(!current(id,stamp))return;setSession(local);setBridge(state);
   if(readOnly){try{const cached=await readOrdersSnapshot({userId,terminalId:local.terminalId,epoch:local.epoch,journalId:state.journalId});if(current(id,stamp))setSnapshot(cached);}catch{if(current(id,stamp))setSnapshot(null);}}
   try{await refreshSnapshot(local,state,id,stamp);}catch(e){if(e instanceof AuthorizationDenied)throw e;if(current(id,stamp))setMessage(readOnly?"Cloud unavailable. Only a valid prepared snapshot can be viewed; full history requires connectivity.":"Snapshot could not be prepared. Existing online Orders remain available.");}
 }catch(e){if(current(id,stamp)){setSnapshot(null);setBridge(null);setSession(null);setMessage(e instanceof Error?e.message:"Orders authorization unavailable.");}}finally{running.current=false;setBusy(false);}}
 useEffect(()=>{if(!session)return;const id=runId.current,stamp=invalidationEpoch();let stopped=false,inFlight=false;const tick=async()=>{if(inFlight||stopped||!current(id,stamp))return;inFlight=true;try{
   const state=await readOrdersBridge(session);if(stopped||!current(id,stamp))return;setBridge(state);
   if(readOnly){const cached=await readOrdersSnapshot({userId,terminalId:session.terminalId,epoch:session.epoch,journalId:state.journalId});if(!stopped&&current(id,stamp))setSnapshot(cached);}
   if(Date.now()-lastCloudTry.current>=60000)try{await refreshSnapshot(session,state,id,stamp);}catch(e){if(e instanceof AuthorizationDenied)throw e;}
 }catch(e){if(!stopped&&current(id,stamp)){setSnapshot(null);setBridge(null);setSession(null);setMessage(e instanceof Error?e.message:"Local Orders authorization unavailable. Sign in again.");}}finally{inFlight=false;}};const timer=setInterval(()=>void tick(),10000);const focus=()=>void tick();window.addEventListener("focus",focus);return ()=>{stopped=true;clearInterval(timer);window.removeEventListener("focus",focus);};},[session,readOnly,userId]);
 const split=splitCloudAndLocal(snapshot?.orders||[],bridge?.history||[],userId),filtered=filterCachedOrders(split.cloud,status,search),limit=30,currentPage=Math.min(page,Math.max(1,Math.ceil(filtered.length/limit)));
 const pending=split.local.map((s,i)=>presentLocalSale(s,i)).filter(o=>(status==="all"||o.status===status)&&(!search.trim()||[o.orderNumber,...o.items.map(i=>i.menuItemName)].some(t=>t.toLowerCase().includes(search.trim().toLowerCase()))));
 const failures=(bridge?.sync?.conflict_count||0)+(bridge?.sync?.needs_review_count||0);
 function applyFilters(nextStatus:string,nextSearch:string,nextPage=1){setStatus(nextStatus);setSearch(nextSearch);setPage(nextPage);const q=new URLSearchParams();if(nextStatus!=="all")q.set("status",nextStatus);if(nextSearch)q.set("search",nextSearch);if(nextPage>1)q.set("page",String(nextPage));history.replaceState(null,"","/orders"+(q.size?"?"+q.toString():""));}
 return <>{readOnly?<OrdersHeader key={status+"|"+search} status={status} search={search} readOnly onFilter={(nextStatus,nextSearch)=>applyFilters(nextStatus,nextSearch)}/>:null}
 <details className="my-2 text-xs text-[#4B5563]" open={readOnly&&!session?true:undefined}><summary>Offline Orders access</summary>
 <label>Local cashier PIN <input type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={12} onChange={e=>setPin(e.target.value)} className="m-2 rounded border px-2 py-1"/></label>
 <button type="button" disabled={busy} onClick={()=>void authorize()} className="rounded border px-2 py-1">{readOnly?"Unlock cached Orders":"Prepare offline Orders"}</button>
 <p>Requires this user's Orders permission and current authorization on this terminal. This view never changes orders or payments.</p></details>
 {message?<Banner text={message}/>:null}
 {snapshot?<Banner text={"Cached cloud Orders · last snapshot "+formatDateTime(new Date(snapshot.createdAt).toISOString())+" · "+snapshot.orders.length+" of at most "+snapshot.limit+" recent orders. Full history and customer details require connectivity."}/>:null}
 {bridge&&(!readOnly||snapshot)?<Banner text={bridge.pendingCount+" terminal cash sales pending synchronization · "+failures+" conflicts or reviews"+(bridge.sync?.enabled===false?" · automatic synchronization disabled":"")+(bridge.sync?.lastError?" · synchronization problem: "+bridge.sync.lastError:"")+". The local list shows at most 20 recent sales for this user; cloud figures exclude matching unacknowledged transactions."}/>:null}
 {readOnly?(snapshot&&session?<OrdersResults orders={filtered.slice((currentPage-1)*limit,currentPage*limit).map(presentCachedOrder)} status={status} search={search} limit={limit} page={currentPage} hasNextPage={filtered.length>currentPage*limit} onPage={p=>applyFilters(status,search,p)} readOnly sourceLabel="cached cloud"/>:<p role="alert" className="my-2 text-sm text-[#9F2D2D]">Cached Orders are locked until this user, session and terminal are verified. No offline changes are allowed.</p>):null}
 {readOnly&&session&&snapshot&&pending.length?<OrdersResults orders={pending} status={status} search={search} limit={20} page={1} hasNextPage={false} readOnly sourceLabel="local cash · awaiting sync"/>:null}
 </>;
}
