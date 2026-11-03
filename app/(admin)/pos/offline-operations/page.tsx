import {ReplenishmentControls} from "@/components/pos/replenishment-controls";
import {RecoveryEvidenceUpload} from "@/components/pos/recovery-evidence-upload";
import {requireOfflineManager,signRecoveryPermit} from "@/lib/pos/offline-operations";
import {createAdminSupabaseClient} from "@/lib/supabase/server";
import {offlineDecisionAction,offlineTerminalAction,offlineEnrollAction,offlineReturnAction,offlineFundAction,offlineLookupAction,offlineRecoveryPermitAction,offlineKeyRotationAction,offlineConflictReviewAction,offlineBindJournalAction} from "@/lib/pos/offline-operations-actions";
import {CloseOfflineAllocation} from "@/components/pos/close-offline-allocation";
export const dynamic="force-dynamic";
type Row=Record<string,any>;
function Reason(){return <label>Reason (required)<input name="reason" required minLength={10} maxLength={2000} className="block w-full rounded border p-2" /></label>;}
function Id(){return <input type="hidden" name="decisionId" value={crypto.randomUUID()} />;}
export default async function OfflineOperations({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const actor=await requireOfflineManager(),params=await searchParams,db=createAdminSupabaseClient();
 const filters=Object.fromEntries(["terminal","cashier","date","issue","status","transaction"].map(k=>[k,params[k]||""]));
 const {data,error}=await db.rpc("get_pos_offline_operations",{p_manager:actor.userId,p_filters:filters});
 if(error||!data)return <section className="surface-card p-6">Offline operations require the reviewed development migrations. No financial records were changed.</section>;
 const {data:catalog}=await db.from("menu_items").select("id,name,base_price,code").eq("is_active",true).eq("is_available_today",true).not("portion_type_id","is",null);
 const menus=(catalog||[]).filter((m:Row)=>!["traveller_chicken_meal","traveller_goat_meal","traveller_beef_kebabs","traveller_beef_samosas"].includes(m.code));
 let recoveryToken="";
 if(params.recoveryPermit&&/^[a-f0-9-]{36}$/i.test(params.recoveryPermit)){const {data:permit}=await db.from("pos_offline_recovery_permits").select("*").eq("id",params.recoveryPermit).maybeSingle();if(permit)recoveryToken=await signRecoveryPermit(permit);}
 const bridge=process.env.POS_HARDWARE_BRIDGE_URL||"",local=/^http:\/\/127\.0\.0\.1:\d+$/.test(bridge);
 return <main className="space-y-6 p-4"><h1 className="text-2xl font-semibold">Offline POS operations</h1>
 <p>Manager decisions preserve the original cash sale and its audit evidence. Phones stay online-only and cannot read another computer&apos;s local journal.</p>
 {params.message?<p role="status" className="rounded border p-3">{params.message}</p>:null}
 <form method="get" className="grid gap-2 rounded border p-4 md:grid-cols-3">{Object.keys(filters).map(k=><label key={k}>{k}<input name={k} defaultValue={filters[k]} type={k==="date"?"date":"text"} className="block rounded border p-2" /></label>)}<button>Filter records</button></form>
 <form action={offlineLookupAction} className="rounded border p-4"><h2>Look up an original transaction</h2><input name="transactionId" placeholder="Original transaction UUID" required className="rounded border p-2" /><button>Look up cloud evidence</button></form>
 <section><h2 className="text-xl font-semibold">Financial records and decisions</h2>
 {(data.records as Row[]).map(r=><article key={r.transaction_id} className="my-3 space-y-3 rounded border p-4">
 <h3 className="font-semibold">{r.receipt_id} · USh {r.cash_total} · {r.issue}</h3>
 <p>Transaction {r.transaction_id} · Terminal {r.terminal_id} · Epoch {r.epoch} · Sequence {r.terminal_sequence}</p>
 <p>Original cashier {r.cashier_id} · Business date {r.service_date} · Cloud order {r.order_id||"not posted"}</p>
 <details><summary>Original signed evidence and decision history</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({hash:r.payload_hash,signature:r.signature,evidence:r.evidence,decisions:r.decisions},null,2)}</pre></details>
 <form action={offlineDecisionAction} className="grid gap-2"><Id/><input type="hidden" name="transactionId" value={r.transaction_id}/>
 <label>Decision<select name="action" className="block rounded border p-2">
 <option value="review_evidence">Record evidence review</option><option value="confirm_genuine">Confirm genuine sale and post missing effects</option>
 <option value="flag_duplicate">Flag suspected duplicate for investigation</option><option value="confirmed_duplicate">Confirmed duplicate: link existing sale, no new posting</option>
 <option value="resolve_late">Approve additive signed-close adjustment</option><option value="close_incident">Close an explicitly reconciled incident</option></select></label>
 <label>Existing order reference (confirmed duplicate only)<input name="referenceOrder" type="number" min="1" className="block rounded border p-2"/></label><Reason/><button>Record audited decision</button></form>
 </article>)}
 </section>
 <section><h2 className="text-xl font-semibold">Cloud ingestion conflicts</h2><p>Conflicting identities are evidence for investigation. Resolving a label does not create an order or release stock.</p>
 {(data.conflicts as Row[]).map(r=><details key={r.id} className="my-2 rounded border p-3"><summary>{r.transactionId} · {r.reason}</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(r,null,2)}</pre><form action={offlineConflictReviewAction} className="grid gap-2"><Id/><input type="hidden" name="evidenceId" value={r.id}/><Reason/><button>Record conflict investigation without posting a replacement</button></form></details>)}</section>
 <section><h2 className="text-xl font-semibold">Registered terminals and handover</h2>
 {(data.terminals as Row[]).map(t=><article key={t.terminalId+t.epoch} className="my-3 space-y-3 rounded border p-4">
 <h3>{t.terminalId} · epoch {t.epoch}</h3><p>{t.revoked?"Revoked":t.suspended?"Suspended":"Registered"} · Last contact {t.lastContact||"never"} · {t.stale?"STALE / UNKNOWN":"recent report; not a live journal view"}</p>
 <p>Backup: {t.lastReported?.backup?.[0]?.success===1?"verified checkpoint reported":t.lastReported?.backup?.[0]?"FAILED — review required":"not reported"}. </p><p>Last reported pending: {t.lastReported?.pending_count??"unknown"}. Do not recreate those sales on a phone.</p>
 <details><summary>Last known synchronization and unresolved local outcomes</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(t.lastReported,null,2)}</pre></details>
 <form action={offlineTerminalAction} className="grid gap-2"><Id/><input type="hidden" name="terminalId" value={t.terminalId}/><input type="hidden" name="epoch" value={t.epoch}/>
 <select name="action"><option value="suspend">Suspend new offline commitments</option><option value="resume">Resume a suspended epoch</option><option value="revoke">Revoke terminal</option><option value="prepare_replacement">Fence original and prepare replacement</option><option value="handover">Approve online-only device handover with unresolved activity noted</option></select><Reason/><button>Record terminal decision</button></form>
 <details><summary>Prepare an approved allocation</summary><form action={offlineFundAction} className="grid gap-2"><Id/><input type="hidden" name="terminalId" value={t.terminalId}/><input type="hidden" name="epoch" value={t.epoch}/>
 <p>Initial funding is 65% of eligible available stock, rounded up. That starting target stays fixed. Connected replenishment requires an approved policy and only replaces consumed units.</p>
 <label>Menu items<select name="items" multiple required className="block rounded border p-2">{menus.map((m:Row)=><option key={m.id} value={m.id}>{m.name} · USh {m.base_price}</option>)}</select></label>
 <label>Expires in minutes<input name="minutes" type="number" min="1" max="720" defaultValue="60"/></label><Reason/><button>Fund approved catalog</button></form></details>
 </article>)}</section>
 <details className="rounded border p-4"><summary>Enroll a terminal or a new credential epoch</summary><p>Use the original Windows terminal&apos;s fresh signed enrollment proof. Private keys must never be pasted here. A replacement requires a new key and epoch; outstanding holds are retained.</p>
 <form action={offlineEnrollAction} className="grid gap-2"><Id/>{["terminalId","epoch","nonce"].map(k=><label key={k}>{k}<input required name={k} className="block rounded border p-2"/></label>)}
 <label>Public Ed25519 JWK<textarea name="publicJwk" required className="block w-full rounded border p-2"/></label><label>Fresh enrollment proof<textarea name="proof" required className="block w-full rounded border p-2"/></label><Reason/><button>Verify and enroll</button></form></details>
 <details className="rounded border p-4"><summary>Bind the original upgraded journal</summary><p>For an existing registered Phase 3A/3B journal only. Use its fresh signed proof. A different journal identity requires fenced recovery; outstanding stock stays held.</p>
 <form action={offlineBindJournalAction} className="grid gap-2"><Id/>{["terminalId","epoch","nonce"].map(k=><label key={k}>{k}<input required name={k} className="block rounded border p-2"/></label>)}
 <label>Public Ed25519 JWK<textarea name="publicJwk" required className="block w-full rounded border p-2"/></label><label>Fresh original journal proof<textarea name="proof" required className="block w-full rounded border p-2"/></label><Reason/><button>Verify and bind original journal</button></form></details>
 <section><h2 className="text-xl font-semibold">Allocation lifecycle — physical source units</h2>
 {(data.allocations as Row[]).map(a=><article key={a.allocationId+":"+a.resourceId} className="my-3 space-y-2 rounded border p-4">
 <p>Allocation {a.allocationId} · resource {a.resourceId} · original day {a.date} · {a.state}</p>
 <p>Funded {a.funded}; locally consumed (last report) {a.lastReportedLocalConsumed??"unknown"}; cloud settled {a.settled}; outstanding cloud hold {a.outstandingHold}; verified unused {a.verifiedUnused??"not proven"}; returned {a.returned}.</p>
 {a.initialFunding!=null?<p>Initial funding {a.initialFunding}; fixed starting target {a.target}; total funded {a.funded}; top-ups {a.additionalFunding}; shared cloud availability {a.sharedAvailable}; awaiting cloud acknowledgement {a.pendingActivation}; local confirmed but not activated (last report) {((data.terminals as Row[]).find(t=>t.terminalId===a.terminalId&&t.epoch===a.epoch)?.lastReported?.replenishment as Row[]|undefined)?.find(r=>r.allocationId===a.allocationId&&r.resourceId===a.resourceId)?.confirmedNotActivated??"unknown"}. Last reported local allowance {a.remainingLocalAllowance??"unknown"}; local replenishment request {a.localPendingReplenishment==null?"unknown":a.localPendingReplenishment?"pending":"none"}; {a.lowAllocation?"LOW ALLOCATION":"no reported low warning"}. Terminal report time {a.terminalReportedAt||"unknown"}. Last successful cloud funding: {a.lastReplenishment?new Date(a.lastReplenishment.issuedAt).toLocaleString():"none"}. Local balance and consumption above are last-reported figures, not live journal access.</p>:null}
 {a.resourceId===(data.allocations as Row[]).find(x=>x.allocationId===a.allocationId)?.resourceId?<ReplenishmentControls rows={(data.allocations as Row[]).filter(x=>x.allocationId===a.allocationId)}/>:null}
 <p>Unresolved held units: {a.verifiedUnused==null?"unknown until durable closure":a.outstandingHold-(a.verifiedUnused-a.returned)}. Expiry {a.expiresAt} does not itself release stock.</p>
 {local?<CloseOfflineAllocation terminalId={a.terminalId} epoch={a.epoch} allocationId={a.allocationId} bridgeUrl={bridge}/>:null}
 <form action={offlineReturnAction} className="grid gap-2"><Id/><input type="hidden" name="allocationId" value={a.allocationId}/><Reason/><button>Return only verified unused units / close exhausted allocation</button></form>
 </article>)}</section>
 <section><h2 className="text-xl font-semibold">Signed daily closes and additive adjustments</h2>
 {(data.closeAdjustments as Row[]).map(a=><details key={a.transactionId} className="my-2 rounded border p-3"><summary>{a.date} · original signed cash USh {a.originalSignedCash} · original expected register cash USh {a.originalExpectedCash} · verified adjustments USh {a.verifiedAdjustmentsTotal} · verified adjusted expectation USh {a.verifiedAdjustedExpectedCash} · this late sale USh {a.cashAdjustment} · {a.state}</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(a,null,2)}</pre></details>)}</section>
 <section className="rounded border p-4"><h2 className="text-xl font-semibold">Supervised recovery</h2>
 <p>Fence the original epoch first. A recovered journal is evidence-only: it cannot accept cash or operate hardware. A stale or incomplete backup never proves unused stock.</p>
 <form action={offlineRecoveryPermitAction} className="grid gap-2"><Id/>{["terminalId","epoch","backupHash"].map(k=><label key={k}>{k}<input name={k} required className="block rounded border p-2"/></label>)}<Reason/><button>Issue fenced recovery permit</button></form>
 {recoveryToken?<label>Short-lived evidence-only recovery permit<textarea readOnly value={recoveryToken} className="block w-full rounded border p-2"/></label>:null}
 <RecoveryEvidenceUpload/></section>
 <details className="rounded border p-4"><summary>Review grant-key rotation plan</summary><p>This records an approval plan, not a deployment. Keep all existing verification keys for outstanding sales and recovery evidence. Private keys must never be entered here.</p>
 <form action={offlineKeyRotationAction} className="grid gap-2"><Id/><label>Public verification-key history<textarea name="publicHistory" required className="block w-full rounded border p-2"/></label><Reason/><button>Validate public history and record rotation approval</button></form></details>
 </main>;
}
