import assert from "node:assert/strict";
import {randomUUID,generateKeyPairSync} from "node:crypto";
import {loadTs} from "../tests/pos-test-loader.mjs";
export async function testOfflineOperations({sql,check,station,manager,cashier,concurrent,validation}){
 const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+"::jsonb";
 const reason="Verified historical evidence and independent allocation reconciliation.";
 const call=(name,args)=>JSON.parse(sql("SET ROLE service_role; SELECT "+name+"("+args.join(",")+");"));
 const decision=(id,tx,action,reference=null,actor=manager)=>call("decide_pos_offline_record",[q(id),q(tx),q(actor),q(action),q(reason),reference===null?"null":String(reference)]);
 const counts=()=>sql("SELECT json_build_object('orders',(SELECT count(*) FROM orders),'tenders',(SELECT count(*) FROM pos_tenders),'settlements',(SELECT count(*) FROM pos_offline_stock_settlements));");
 const ops=loadTs("lib/pos/offline-terminal-messages.ts",{"server-only":{},"./offline-ingestion":validation,"./offline-operations":{publicKeySchema:validation.deliverySchema.shape.publicJwk}});
 async function deliver(s,body){
 const proof=await s.operationsProof(body),signed={body,signature:s.signBody(body),publicJwk:s.publicJwk};
 const v=await ops.verifyOperationsDelivery(signed,proof);
 assert.equal(v.terminalKey,s.grant.terminalKey);
 return body.type==="report"?call("record_pos_offline_terminal_report",[j(body),q(v.signature)]):sql("SET ROLE service_role; SELECT record_pos_offline_closure("+j(body)+","+q(v.signature)+","+q(v.payloadHash)+");");
 }
 const report=(s,sequence,pending=0)=>({version:1,type:"report",reportId:randomUUID(),terminalId:s.terminalId,epoch:s.epoch,sequence,reportedAt:new Date().toISOString(),status:{pending_count:pending,issues:[]},allocations:[]});
 function closure(s,sales){
 const manifest=sales.map(({envelope:e})=>{
 const amounts=new Map();for(const item of e.items)for(const r of item.requirements)amounts.set(r.resourceId,(amounts.get(r.resourceId)||0)+item.quantity*r.quantity);
 return {transactionId:e.transactionId,sequence:e.sequence,payloadHash:validation.payloadHash(e),allocationId:e.allocationId,resources:[...amounts].sort(([a],[b])=>a-b).map(([resourceId,quantity])=>({resourceId,quantity}))};
 });
 return {version:1,type:"closure",allocationId:s.allocationId,terminalId:s.terminalId,epoch:s.epoch,sequence:manifest.length,closedAt:new Date().toISOString(),manifest,
 unused:s.grant.budgets.map(b=>({resourceId:b.resourceId,quantity:b.quantity-manifest.reduce((n,m)=>n+(m.resources.find(r=>r.resourceId===b.resourceId)?.quantity||0),0)}))};
 }
 const s=await station("phase3c_approval",2),sale=s.make(4);
 sql("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id="+q(cashier)+";");
 const held=await s.post(sale);assert.equal(held.body.acknowledgement.disposition,"needs_review");
 const before=counts(),dec=randomUUID();
 check("Phase 3C manager permissions reject cashier financial approvals",()=>{
 assert.throws(()=>decision(randomUUID(),sale.envelope.transactionId,"confirm_genuine",null,cashier),/offline_manager_and_reason_required/);assert.equal(counts(),before);
 });
 const approved=decision(dec,sale.envelope.transactionId,"confirm_genuine");
 sql("UPDATE auth.users SET banned_until=null WHERE id="+q(cashier)+";");
 check("Manager confirms genuine capture after cashier disablement with actual atomic financial posting",()=>{
 assert.ok(approved.orderId);assert.deepEqual(s.stock(),{finished:13,reserved:3,sold:4,remaining:13,held:3});
 const row=JSON.parse(sql("SELECT row_to_json(i) FROM pos_offline_ingestions i WHERE transaction_id="+q(sale.envelope.transactionId)+";"));
 assert.equal(row.order_id,null);assert.deepEqual(row.acknowledgement,held.body.acknowledgement);
 assert.equal(sql("SELECT cash_sales_ugx>=8000 FROM get_daily_cash_reconciliation("+q(s.grant.serviceDate)+",0);"),"t");
 });
 check("Manager decision identity, reason, timestamp and canonical reference are immutable and idempotent",()=>{
 const after=counts();assert.deepEqual(decision(dec,sale.envelope.transactionId,"confirm_genuine"),approved);assert.equal(counts(),after);
 assert.equal(sql("SELECT reviewer_id::text FROM pos_offline_decisions WHERE id="+q(dec)+";"),manager);
 assert.equal(sql("SELECT reason FROM pos_offline_decisions WHERE id="+q(dec)+";"),reason);
 assert.throws(()=>decision(dec,sale.envelope.transactionId,"flag_duplicate"),/identity_conflict/);
 assert.throws(()=>sql("UPDATE pos_offline_decisions SET reason='edited' WHERE id="+q(dec)+";"),/immutable/);
 assert.throws(()=>sql("UPDATE pos_offline_approved_postings SET acknowledgement='{}' WHERE transaction_id="+q(sale.envelope.transactionId)+";"),/immutable/);
 });
 check("Review and duplicate suspicion alone cannot close an unposted cash exception",()=>{
 const target=sql("SELECT transaction_id::text FROM pos_offline_ingestions WHERE order_id IS NULL AND NOT EXISTS(SELECT 1 FROM pos_offline_approved_postings p WHERE p.transaction_id=pos_offline_ingestions.transaction_id) LIMIT 1;");
 decision(randomUUID(),target,"flag_duplicate");
 assert.throws(()=>decision(randomUUID(),target,"close_incident"),/explicit_accounting_resolution/);
 });

 const certificateReport=report(s,1,1);certificateReport.status.issues=[{transactionId:sale.envelope.transactionId,payloadHash:validation.payloadHash(sale.envelope)}];
 const certificates=await deliver(s,certificateReport);
 check("Manager resolutions return hash-bound certificates without rewriting original acknowledgements",()=>{
  assert.equal(certificates.resolutions.length,1);assert.equal(certificates.resolutions[0].payloadHash,validation.payloadHash(sale.envelope));assert.equal(certificates.resolutions[0].orderId,approved.orderId);
 });
 const wrongCertificate=report(s,1,1);wrongCertificate.status.issues=[{transactionId:sale.envelope.transactionId,payloadHash:"x".repeat(43)}];
 const mismatchedCertificate=await deliver(s,wrongCertificate);
 check("A different local sale hash never receives another payload's resolution certificate",()=>assert.equal(mismatchedCertificate.resolutions.length,0));
 const body=closure(s,[sale]);
 check("Expired grant and zero cloud-reported pending count never suffice for releasing stock",()=>{
 assert.throws(()=>call("return_pos_offline_unused",[q(manager),q(s.allocationId),q(reason),q(randomUUID())]),/durable_closure/);
 });
 await deliver(s,report(s,1));
 check("Fresh signed terminal report still does not substitute for durable closure evidence",()=>{
 assert.throws(()=>call("return_pos_offline_unused",[q(manager),q(s.allocationId),q(reason),q(randomUUID())]),/durable_closure/);
 });
 const bad=structuredClone(body);bad.manifest[0].resources[0].quantity=0;
 await assert.rejects(deliver(s,bad),/manifest_mismatch/);
 await deliver(s,body);
 const movements=Number(sql("SELECT count(*) FROM finished_stock_movements;")),returnDecision=randomUUID();
 const returned=call("return_pos_offline_unused",[q(manager),q(s.allocationId),q(reason),q(returnDecision)]);
 check("Verified unused stock returns exactly once and exhausted allocation closes without replenishment",()=>{
 assert.equal(returned.status,"reconciled");assert.deepEqual(s.stock(),{finished:16,reserved:0,sold:4,remaining:16,held:0});
 assert.deepEqual(call("return_pos_offline_unused",[q(manager),q(s.allocationId),q(reason),q(returnDecision)]),returned);
 call("return_pos_offline_unused",[q(manager),q(s.allocationId),q(reason),q(randomUUID())]);
 assert.equal(Number(sql("SELECT count(*) FROM finished_stock_movements;")),movements+1);
 assert.equal(sql("SELECT critical_count FROM get_business_truth_health_snapshot(now(),"+q(s.grant.serviceDate)+");"),"0");
 });
 const rejected=await s.post(s.make(1));
 check("Closed allocation cannot accept a new identity after stock has been returned",()=>assert.equal(rejected.status,409));
 const duplicate=await s.post(sale);
 check("Existing historical ingestion remains its original immutable acknowledgement after manager approval",()=>assert.deepEqual(duplicate.body.acknowledgement,held.body.acknowledgement));
 const race=await Promise.all([
 concurrent("SET ROLE service_role; SELECT return_pos_offline_unused("+[q(manager),q(s.allocationId),q(reason),q(randomUUID())].join(",")+");"),
 concurrent("SET ROLE service_role; SELECT decide_pos_offline_record("+[q(randomUUID()),q(sale.envelope.transactionId),q(manager),q("confirm_genuine"),q(reason),"null"].join(",")+");")
 ]);
 check("Manager settlement/return concurrency cannot produce a second tender or stock return",()=>{
 assert.ok(race.every(r=>r.code===0),JSON.stringify(race));assert.deepEqual(s.stock(),{finished:16,reserved:0,sold:4,remaining:16,held:0});
 assert.equal(sql("SELECT count(*) FROM pos_offline_approved_postings WHERE transaction_id="+q(sale.envelope.transactionId)+";"),"1");
 });
 const late=await station("phase3c_late_review",1),lateSale=late.make(1);const lateResult=await late.post(lateSale);assert.equal(lateResult.body.acknowledgement.disposition,"needs_review");
 const signed=sql("SELECT snapshot::text FROM daily_close_snapshots WHERE service_date="+q(late.grant.serviceDate)+";"),beforeLate=counts(),lateDecision=randomUUID();
 const adjustment=decision(lateDecision,lateSale.envelope.transactionId,"resolve_late");
 check("Late-close review records one additive adjustment and leaves signed close and cash tender untouched",()=>{
 assert.equal(adjustment.additiveCashAdjustment,2000);assert.equal(adjustment.noAdditionalTender,true);assert.equal(counts(),beforeLate);
 assert.equal(sql("SELECT snapshot::text FROM daily_close_snapshots WHERE service_date="+q(late.grant.serviceDate)+";"),signed);
 assert.deepEqual(decision(lateDecision,lateSale.envelope.transactionId,"resolve_late"),adjustment);
 assert.throws(()=>decision(randomUUID(),lateSale.envelope.transactionId,"resolve_late"),/duplicate key/);
 assert.equal(sql("SELECT count(*) FROM pos_offline_close_resolutions WHERE transaction_id="+q(lateSale.envelope.transactionId)+";"),"1");
 decision(randomUUID(),lateSale.envelope.transactionId,"close_incident");
 });
 const control=await station("phase3c_terminal_control"),controlSale=control.make(1);
 const manage=(action,actor=manager)=>call("manage_pos_offline_terminal",[q(actor),q(control.terminalId),q(control.epoch),q(action),q(reason),q(randomUUID())]);
 manage("suspend");
 check("Suspension stops new grants while preserving original bounded capture evidence",()=>{
 assert.throws(()=>sql("SELECT get_pos_offline_snapshot("+[q(control.terminalId),q(control.epoch),q(control.grant.terminalKey),q(cashier)].join(",")+");"),/terminal_suspended/);
 });
 const historical=await control.post(controlSale);
 check("Suspension does not discard previously authorized historical cash",()=>assert.equal(historical.body.acknowledgement.disposition,"acknowledged"));
 manage("revoke");
 check("Revocation cannot be silently resumed and preserves funded stock",()=>{
 assert.throws(()=>manage("resume"),/revoked_epoch/);assert.equal(control.stock().held,6);
 assert.throws(()=>sql("SELECT register_pos_offline_terminal("+[q(control.terminalId),q(randomUUID()),q("z".repeat(43)),q(manager)].join(",")+");"),/reconcile_terminal/);
 });
 const recoveryId=randomUUID();
 const recovery=call("issue_pos_offline_recovery",[q(recoveryId),q(control.terminalId),q(control.epoch),q("a".repeat(64)),q(manager),q(reason)]);
 check("Recovery permits bind fenced terminal, epoch, backup hash and cloud watermark",()=>{
 assert.equal(recovery.mode,"evidence-only");assert.equal(recovery.fenced,true);assert.equal(recovery.minimumSequence,1);
 assert.throws(()=>call("issue_pos_offline_recovery",[q(randomUUID()),q(s.terminalId),q(s.epoch),q("b".repeat(64)),q(manager),q(reason)]),/must_be_fenced/);
 assert.throws(()=>sql("UPDATE pos_offline_recovery_permits SET minimum_sequence=0 WHERE id="+q(recoveryId)+";"),/immutable/);
 });
 const recoveredSale=control.make(1),beforeImport=counts();
 const recovered=call("import_pos_offline_recovery",[q(recoveryId),j(recoveredSale.envelope),q(recoveredSale.signature),q(validation.payloadHash(recoveredSale.envelope)),j(control.grant),q(manager),q(randomUUID())]);
 check("Recovered authentic historical cash is archived for review, not automatically posted",()=>{assert.equal(recovered.disposition,"needs_review");assert.equal(counts(),beforeImport);});
 const recoveredApproval=decision(randomUUID(),recoveredSale.envelope.transactionId,"confirm_genuine");
 check("Manager approved recovery posts exactly once under its original identity and epoch",()=>{assert.ok(recoveredApproval.orderId);assert.equal(control.stock().held,5);assert.equal(sql("SELECT epoch::text FROM pos_offline_ingestions WHERE transaction_id="+q(recoveredSale.envelope.transactionId)+";"),control.epoch);});
 await deliver(control,report(control,5,1));
 const regression=await deliver(control,report(control,1,0));
 check("Sequence regression flags stale/clone-like reports and never implies stock may be released",()=>{
 assert.equal(regression.control.suspended,true);
 const view=call("get_pos_offline_operations",[q(manager),j({terminal:control.terminalId})]);assert.equal(view.terminals.find(t=>t.terminalId===control.terminalId).lastReported.pending_count,0);
 assert.throws(()=>call("return_pos_offline_unused",[q(manager),q(control.allocationId),q(reason),q(randomUUID())]),/durable_closure/);
 });
 const filtered=call("get_pos_offline_operations",[q(manager),j({terminal:s.terminalId,transaction:sale.envelope.transactionId})]);
 check("Manager filters and immutable supporting evidence never expose authorization tokens",()=>{
 assert.equal(filtered.records.length,1);assert.equal(filtered.records[0].order_id,approved.orderId);assert.equal("authorization" in filtered.records[0].evidence,false);
 assert.ok(!JSON.stringify(filtered).includes(sale.envelope.authorization));
 assert.throws(()=>call("get_pos_offline_operations",[q(cashier),j({})]),/manager_and_reason/);
 });
 check("Phone lookup never claims to know a missing local journal or manufacture a replacement",()=>{
 const unknown=call("lookup_pos_offline_transaction",[q(cashier),q(randomUUID())]);assert.equal(unknown.known,false);assert.match(unknown.localStatus,/cannot inspect/);
 const status=call("get_pos_offline_handover_status",[q(cashier)]);
 assert.ok(status.every(t=>t.journalAccessibleFromThisDevice===false));assert.ok(status.some(t=>t.lastContact===null&&t.stale));
 });
 const rotating=await station("phase3c_key_rotation"),oldSale=rotating.make(1),newKey=generateKeyPairSync("ed25519");
 const privateBefore=process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64,historyBefore=process.env.POS_OFFLINE_GRANT_VERIFYING_JWKS_B64;
 try{
   process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64=Buffer.from(JSON.stringify(newKey.privateKey.export({format:"jwk"}))).toString("base64url");
   delete process.env.POS_OFFLINE_GRANT_VERIFYING_JWKS_B64;
   await assert.rejects(validation.verifyOfflineEvidence(oldSale));
   const oldPublic=(await import("node:crypto")).createPublicKey((await import("node:crypto")).createPrivateKey({key:JSON.parse(Buffer.from(privateBefore,"base64url").toString("utf8")),format:"jwk"})).export({format:"jwk"});
   process.env.POS_OFFLINE_GRANT_VERIFYING_JWKS_B64=Buffer.from(JSON.stringify({keys:[oldPublic]})).toString("base64url");
   const rotatedResult=await rotating.post(oldSale);
   check("Grant-key rotation preserves verification and ingestion of already captured historical sales",()=>{assert.equal(rotatedResult.status,200,JSON.stringify(rotatedResult.body));assert.equal(rotatedResult.body.acknowledgement.disposition,"acknowledged");});
   check("Key-rotation approvals contain public keys only and retain an immutable reviewer trail",()=>{
    const plan=randomUUID();sql("SET ROLE service_role; SELECT audit_pos_offline_key_rotation("+[q(plan),q(manager),q(reason),j([oldPublic,newKey.publicKey.export({format:"jwk"})])].join(",")+");");
    assert.equal(sql("SELECT reviewer_id::text FROM pos_offline_decisions WHERE id="+q(plan)+";"),manager);
    assert.throws(()=>sql("SET ROLE service_role; SELECT audit_pos_offline_key_rotation("+[q(randomUUID()),q(manager),q(reason),j([newKey.privateKey.export({format:"jwk"})])].join(",")+");"),/public_ed25519_history/);
   });
 }finally{if(privateBefore===undefined)delete process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64;else process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64=privateBefore;if(historyBefore===undefined)delete process.env.POS_OFFLINE_GRANT_VERIFYING_JWKS_B64;else process.env.POS_OFFLINE_GRANT_VERIFYING_JWKS_B64=historyBefore;}

 const duplicateStation=await station("phase3c_physical_duplicate",2),duplicateSale=duplicateStation.make(4);
 sql("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id="+q(cashier)+";");
 await duplicateStation.post(duplicateSale);sql("UPDATE auth.users SET banned_until=null WHERE id="+q(cashier)+";");
 const beforeDuplicate=counts(),duplicateDecision=randomUUID();
 const duplicateResolution=decision(duplicateDecision,duplicateSale.envelope.transactionId,"confirmed_duplicate",approved.orderId);
 check("Confirmed physical duplicate links one canonical order without inventing a second tender or stock settlement",()=>{
  assert.equal(counts(),beforeDuplicate);assert.equal(duplicateResolution.orderId,approved.orderId);
  assert.throws(()=>decision(randomUUID(),duplicateSale.envelope.transactionId,"confirm_genuine"),/duplicate/);
  assert.equal(duplicateStation.stock().held,7);
 });
 await deliver(duplicateStation,closure(duplicateStation,[duplicateSale]));
 call("return_pos_offline_unused",[q(manager),q(duplicateStation.allocationId),q(reason),q(randomUUID())]);
 check("Confirmed duplicate consumption stays held while only independently proven unused units return",()=>{
  assert.equal(duplicateStation.stock().held,4);assert.equal(duplicateStation.stock().finished,16);
  assert.equal(sql("SELECT count(*) FROM pos_offline_stock_settlements WHERE transaction_id="+q(duplicateSale.envelope.transactionId)+";"),"0");
 });

 const closureRace=await station("phase3c_closure_race",2),firstRaceSale=closureRace.make(4);
 sql("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id="+q(cashier)+";");
 await closureRace.post(firstRaceSale);sql("UPDATE auth.users SET banned_until=null WHERE id="+q(cashier)+";");
 decision(randomUUID(),firstRaceSale.envelope.transactionId,"confirmed_duplicate",approved.orderId);
 const raceClosure=closure(closureRace,[firstRaceSale]),raceSignature=closureRace.signBody(raceClosure),rogueSale=closureRace.make(1);
 const closing=concurrent("SET application_name='phase3c_closure_race'; SET ROLE service_role; BEGIN; SELECT manage_pos_offline_terminal("+[q(manager),q(closureRace.terminalId),q(closureRace.epoch),q("authorize_closure"),q(reason),q(randomUUID())].join(",")+"); SELECT pg_sleep(2); SELECT record_pos_offline_closure("+[j(raceClosure),q(raceSignature),q(validation.payloadHash(raceClosure))].join(",")+"); SELECT return_pos_offline_unused("+[q(manager),q(closureRace.allocationId),q(reason),q(randomUUID())].join(",")+"); COMMIT;");
 let locked=false;for(let attempt=0;attempt<20;attempt++){if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='phase3c_closure_race' AND wait_event='PgSleep');")==="t"){locked=true;break;}await new Promise(r=>setTimeout(r,10));}
 assert.ok(locked,"closure transaction owns the terminal lock");
 const ingestion=concurrent("SET ROLE service_role; SELECT ingest_pos_offline_cash_sale("+[j(rogueSale.envelope),q(rogueSale.signature),q(validation.payloadHash(rogueSale.envelope)),j(closureRace.grant)].join(",")+");");
 const [closed,lateIngest]=await Promise.all([closing,ingestion]);
 check("Concurrent ingestion cannot pass closure validation before waiting for a stock-return lock",()=>{
  assert.equal(closed.code,0,JSON.stringify(closed));assert.notEqual(lateIngest.code,0);assert.match(JSON.stringify(lateIngest),/offline_allocation_closed/);
  assert.equal(closureRace.stock().held,4);assert.equal(closureRace.stock().finished,16);
  assert.equal(sql("SELECT count(*) FROM pos_offline_ingestions WHERE transaction_id="+q(rogueSale.envelope.transactionId)+";"),"0");
 });
 const bindingStation=await station("phase3c_binding"),journalId=randomUUID();
 check("Existing terminal journal binding requires original legacy proof and never silently replaces an identity",()=>{
  const args=[q(bindingStation.terminalId),q(bindingStation.epoch),q(bindingStation.grant.terminalKey),q(journalId),"0","false",q(manager),q(reason),q(randomUUID())];
  assert.throws(()=>call("bind_existing_pos_offline_journal",args),/original_journal/);
  args[5]="true";call("bind_existing_pos_offline_journal",args);
  const found=call("get_pos_offline_journal_binding",[q(bindingStation.terminalId),q(bindingStation.epoch),q(bindingStation.grant.terminalKey)]);
  assert.equal(found.journalId,journalId);
  args[3]=q(randomUUID());args[8]=q(randomUUID());
  assert.throws(()=>call("bind_existing_pos_offline_journal",args),/replacement_requires_fencing/);
 });
 check("Managed enrollment enforces one active Windows journal; phones cannot enroll another concurrent terminal",()=>{
  assert.throws(()=>call("enroll_bound_pos_offline_terminal",[q(randomUUID()),q(randomUUID()),q("n".repeat(43)),q(randomUUID()),q(manager),q(reason),q(randomUUID())]),/single_windows_terminal/);
 });
 call("manage_pos_offline_terminal",[q(manager),q(bindingStation.terminalId),q(bindingStation.epoch),q("revoke"),q(reason),q(randomUUID())]);
 const replacementId=randomUUID(),replacementEpoch=randomUUID(),replacementJournal=randomUUID(),newPublicKey="n".repeat(43);
 const replacement=call("enroll_bound_pos_offline_terminal",[q(replacementId),q(replacementEpoch),q(newPublicKey),q(replacementJournal),q(manager),q(reason),q(randomUUID())]);
 check("Fenced replacement receives a fresh key and epoch without releasing the original stock holds",()=>{
  assert.equal(replacement.journalId,replacementJournal);assert.equal(bindingStation.stock().held,7);
  assert.equal(sql("SELECT enabled FROM pos_offline_terminals WHERE terminal_id="+q(bindingStation.terminalId)+" AND epoch="+q(bindingStation.epoch)+";"),"f");
 });
 check("Operations tables and mutating RPCs remain service-only under real ACLs/RLS",()=>{
 for(const table of ["pos_offline_decisions","pos_offline_closures","pos_offline_stock_returns","pos_offline_recovery_permits"])for(const role of ["anon","authenticated","service_role"])
 assert.equal(sql("SELECT has_table_privilege("+q(role)+","+q("public."+table)+",'INSERT');"),"f");
 for(const role of ["anon","authenticated"])assert.equal(sql("SELECT has_function_privilege("+q(role)+",'public.return_pos_offline_unused(uuid,uuid,text,uuid)','EXECUTE');"),"f");
 });
}
