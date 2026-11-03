"use client";
import {useState} from "react";
export function CloseOfflineAllocation({terminalId,epoch,allocationId,bridgeUrl}:{terminalId:string;epoch:string;allocationId:string;bridgeUrl:string}){
 const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[reason,setReason]=useState("");
 async function close(){setBusy(true);try{
 const p=await fetch("/api/admin/pos/offline/manage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({terminalId,epoch,allocationId,reason})});
 const grant=await p.json();if(!p.ok)throw Error("Manager closure authorization unavailable.");
 const response=await fetch(bridgeUrl+"/offline/manage/close",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:grant.token}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error("Closure blocked. Resolve pending sales/drafts and use the original POS computer.");
 setMessage("Durable closure saved. Its original terminal will submit the proof; a manager may return verified unused stock after grant expiry.");
 }catch(error){setMessage(error instanceof Error?error.message:"Original POS terminal is unreachable.");}finally{setBusy(false);}}
 return <div><label>Closure reason<input value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={1800} className="rounded border p-2"/></label><button type="button" onClick={close} disabled={busy||reason.trim().length<10}>Close on this Windows POS</button><p>{message}</p></div>;
}
