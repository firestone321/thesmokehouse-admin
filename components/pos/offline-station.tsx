"use client";
import { useState } from "react";
export function OfflineStation({cashierId,bridgeUrl}:{cashierId:string;bridgeUrl:string}) {
  const [pin,setPin]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function provision() {
    setBusy(true);setMessage("");
    try {
      if(!/^\d{8,12}$/.test(pin))throw Error("Choose an 8–12 digit offline PIN.");
      const nonce=crypto.randomUUID();
      const infoResponse=await fetch(bridgeUrl+"/offline/info?nonce="+nonce,{cache:"no-store",signal:AbortSignal.timeout(8000)});
      if(!infoResponse.ok)throw Error("This terminal's offline bridge is unavailable or disabled.");
      const info=await infoResponse.json();
      const grantResponse=await fetch("/api/admin/pos/offline/grant",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({terminalId:info.terminalId,epoch:info.epoch,publicJwk:info.publicJwk,nonce,proof:info.proof}),signal:AbortSignal.timeout(15000)});
      const grant=await grantResponse.json();if(!grantResponse.ok)throw Error(grant.message||"Authorization unavailable.");
      const installed=await fetch(bridgeUrl+"/offline/provision",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({token:grant.token,pin,bindingReceipt:grant.bindingReceipt}),signal:AbortSignal.timeout(12000)});
      const result=await installed.json();if(!installed.ok)throw Error(result.error?.message||"Local provisioning failed; check before retrying.");
      setPin("");setMessage("Offline authorization installed. Use Cash POS connection in Counter sales to sign in with this PIN.");
    }catch(e){setMessage(e instanceof Error?e.message:"Offline provisioning unavailable.");}
    finally{setBusy(false);}
  }
  return <details className="surface-card rounded-2xl p-4"><summary>Local cash station</summary>
    <p className="my-3 text-sm">Uses this registered PC and its reserved stock. Local cash sales remain on this PC until server synchronization is available. Use one workflow for each physical sale.</p>
    <p className="my-3 text-sm" role="note">If an online sale has an unknown outcome, do not record that payment again here. Ask a manager to review the original sale and its idempotency key when the connection returns. A timeout or a missing lookup result does not confirm that it failed.</p>
    <label className="block text-sm">Offline PIN <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={pin}
      onChange={e=>setPin(e.target.value)} className="m-2 rounded border p-2" /></label>
    <button disabled={busy} type="button" onClick={()=>void provision()} className="rounded border p-2">Prepare this cashier while online</button>
    <p className="mt-2 text-xs">Use Cash POS connection in Counter sales to sign in locally and keep using the same cart.</p>
    {message?<p role="status" className="mt-3">{message}</p>:null}
  </details>;
}
