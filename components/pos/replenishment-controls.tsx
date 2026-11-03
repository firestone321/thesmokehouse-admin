import {offlineReplenishmentPolicyAction,offlineManagerReplenishAction} from "@/lib/pos/offline-operations-actions";
export function ReplenishmentControls({rows}:{rows:Record<string,any>[]}){
 if(process.env.POS_OFFLINE_REPLENISHMENT_ENABLED!=="true"||!rows.length)return null;
 const first=rows[0],policy=first.replenishmentPolicy;
 return <details className="rounded border p-3"><summary>Manager replenishment policy</summary>
 <p>The starting target stays fixed. Top-ups replace only consumed quantities, within available cloud stock and these approved limits. Lower automatic limits may leave a partial restoration.</p>
 <form action={offlineReplenishmentPolicyAction} className="space-y-3">
 <input type="hidden" name="decisionId" value={crypto.randomUUID()}/><input type="hidden" name="allocationId" value={first.allocationId}/>
 <input type="hidden" name="resources" value={JSON.stringify(rows.map(r=>r.resourceId))}/>
 <label><input name="enabled" type="checkbox" defaultChecked={policy?.enabled===true}/> Enable connected automatic replenishment</label>
 {rows.map(r=>{const limit=policy?.limits?.find((l:Record<string,any>)=>l.resourceId===r.resourceId);
 return <fieldset key={r.resourceId} className="grid gap-2 rounded border p-3 md:grid-cols-2"><legend>Physical resource {r.resourceId}</legend>
 {[
 ["target","Maximum allowance",limit?.maxTarget??r.target,1,r.target],
 ["trigger","Request at or below target %",limit?.triggerPercent??50,1,99],
 ["warn","Low warning at or below target %",limit?.warnPercent??25,1,99],
 ["maximum","Maximum units per top-up",limit?.maxTopup??r.target,1,r.target],
 ["approval","Automatic units limit; larger needs manager",limit?.approvalAbove??r.target,0,r.target]
 ].map(([name,label,value,min,max])=><label key={String(name)}>{label}<input type="number" name={name+"_"+r.resourceId} required min={Number(min)} max={Number(max)} defaultValue={Number(value)} className="block rounded border p-2"/></label>)}
 </fieldset>;})}
 <label>Approval reason<input name="reason" required minLength={10} maxLength={2000} className="block w-full rounded border p-2"/></label>
 <button>Save audited policy</button></form>
 <form action={offlineManagerReplenishAction} className="mt-4 grid gap-2">
 <input type="hidden" name="decisionId" value={crypto.randomUUID()}/><input type="hidden" name="allocationId" value={first.allocationId}/><input type="hidden" name="terminalId" value={first.terminalId}/><input type="hidden" name="epoch" value={first.epoch}/>
 <p>Explicit approval can bypass the automatic trigger/automatic units limit. It cannot exceed the fixed target, per-top-up maximum, consumed deficit or available stock.</p>
 <label>Reason<input name="reason" required minLength={10} maxLength={2000} className="block w-full rounded border p-2"/></label>
 <button>Approve a capped replenishment</button></form></details>;
}
