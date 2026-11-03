import assert from "node:assert/strict";
import fs from "node:fs";
import {randomUUID} from "node:crypto";
export async function testOfflineReplenishment({sql,check,station,manager,cashier,concurrent,validation}){
 const migration=fs.readFileSync("db/phase-113-dynamic-pos-allocation.sql","utf8"),body=migration.replace(/^begin;$/m,"").replace(/^commit;$/m,"");
 const protectedSql="SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('create_pos_sale','create_pos_sale_with_receipt','reserve_paid_order_stock','get_daily_cash_reconciliation');";

 const legacy=await station("phase3d_legacy_before113"),legacySale=legacy.make(1);
 const legacyBudget=sql("SELECT budgets::text FROM pos_offline_allocations WHERE id='"+legacy.allocationId+"';");
 const signedCloseBefore=sql("SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]')::text FROM daily_close_snapshots s;");
 const before=sql(protectedSql);
 sql("SET ROLE postgres;BEGIN;\n"+body+"\nROLLBACK;");
 check("Phase 113 additive migration rolls back without changing existing Phase 2 financial RPCs",()=>assert.equal(sql(protectedSql),before));
 sql("SET ROLE postgres;\n"+migration);
 check("Phase 113 compiles against real constraints, RLS and accounting functions",()=>assert.equal(sql(protectedSql),before));

 const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+"::jsonb";
 const call=(name,args)=>JSON.parse(sql("SET ROLE service_role;SELECT "+name+"("+args.join(",")+");"));

 const legacyResult=await legacy.post(legacySale);
 check("Previously signed 35% allocation cash still ingests after Phase 113 without changing its original budget",()=>{
  assert.equal(legacyResult.status,200,JSON.stringify(legacyResult));assert.equal(legacy.grant.budgets[0].quantity,7);
  assert.equal(sql("SELECT budgets::text FROM pos_offline_allocations WHERE id='"+legacy.allocationId+"';"),legacyBudget);
  assert.equal(legacy.stock().held,6);
 });
 const legacyClosure={version:1,type:"closure",allocationId:legacy.allocationId,terminalId:legacy.terminalId,epoch:legacy.epoch,sequence:1,closedAt:new Date().toISOString(),
 manifest:[{transactionId:legacySale.envelope.transactionId,sequence:1,payloadHash:validation.payloadHash(legacySale.envelope),allocationId:legacy.allocationId,resources:[{resourceId:legacy.ids.portion,quantity:1}]}],
 unused:[{resourceId:legacy.ids.portion,quantity:6}]};
 sql("SET ROLE service_role;SELECT record_pos_offline_closure("+j(legacyClosure)+","+q(legacy.signBody(legacyClosure))+","+q(validation.payloadHash(legacyClosure))+");");
 check("Legacy Phase 3C closure without a funding manifest remains valid when no top-up exists",()=>assert.equal(sql("SELECT count(*) FROM pos_offline_closures WHERE allocation_id="+q(legacy.allocationId)+";"),"1"));
 const reason="Approved fixed starting target and consumed-only replenishment limits.";

 function terminalReport(s,journalId,pending=0,syncEnabled=true){
  const sequence=Number(sql("SELECT coalesce(max(terminal_sequence),0) FROM pos_offline_ingestions WHERE terminal_id="+q(s.terminalId)+" AND epoch="+q(s.epoch)+";"));
  const body={version:1,type:"report",reportId:randomUUID(),terminalId:s.terminalId,epoch:s.epoch,journalId,sequence,reportedAt:new Date().toISOString(),status:{pending_count:pending,syncEnabled},allocations:[]};
  call("record_pos_offline_terminal_report",[j(body),q(s.signBody(body))]);return body;
 }
 const bind=(s,ready=true)=>{const journalId=randomUUID();sql("UPDATE pos_offline_terminals SET journal_id="+q(journalId)+" WHERE terminal_id="+q(s.terminalId)+" AND epoch="+q(s.epoch)+";");if(ready)terminalReport(s,journalId);return journalId;};
 const policy=(s,options={})=>call("configure_pos_replenishment",[q(randomUUID()),q(s.allocationId),options.enabled===false?"false":"true",j(s.grant.budgets.map(b=>({resourceId:b.resourceId,maxTarget:b.quantity,triggerPercent:options.trigger??50,warnPercent:25,maxTopup:b.quantity,approvalAbove:options.approval??b.quantity}))),q(options.actor||manager),q(reason)]);
 const request=(s,journalId,id=randomUUID(),actor=null)=>{terminalReport(s,journalId);return call("request_pos_replenishment",[q(id),q(s.allocationId),q(s.terminalId),q(s.epoch),q(journalId),actor?q(actor):"null",actor?q(reason):"null"]);};
 const ack=(s,receipt)=>{const body={version:1,type:"replenishment_ack",terminalId:s.terminalId,epoch:s.epoch,journalId:receipt.journalId,sequence:0,replenishmentId:receipt.id,allocationId:s.allocationId,receiptHash:validation.payloadHash(receipt)};
 return call("ack_pos_replenishment",[j(body),q(s.signBody(body))]);};
 const online=(s,quantity)=>"SELECT create_pos_sale_with_receipt("+[q(randomUUID()),q("b".repeat(64)),q(cashier),q("cash"),String(quantity*2000),"null",j([{menu_item_id:s.ids.menu,quantity}])].join(",")+");";
 const s=await station("phase3d_initial",0,40),journalId=bind(s);
 check("65% of forty eligible physical units initially funds twenty-six and leaves fourteen shared",()=>{
  assert.equal(s.grant.budgets[0].quantity,26);assert.deepEqual(s.stock(),{finished:14,reserved:26,sold:0,remaining:14,held:26});
 });
 const rounded=await station("phase3d_round",0,3);
 check("65% initial funding rounds upward in whole physical units",()=>assert.equal(rounded.grant.budgets[0].quantity,2));
 check("Existing same-day target cannot be recreated by repeatedly funding remaining stock",()=>assert.throws(()=>sql("SELECT fund_pos_offline_allocation("+[q(randomUUID()),q(s.terminalId),q(s.epoch),q(randomUUID()),"ARRAY["+s.ids.menu+"]::bigint[]","null","now()+interval '5 minutes'",q(manager)].join(",")+");"),/existing_allocation|same_day_target/));
 const beforePolicy=request(s,journalId);
 check("Automatic funding is disabled until an explicit manager policy is approved",()=>{assert.equal(beforePolicy.disposition,"policy_disabled");assert.equal(s.stock().finished,14);});
 check("Cashiers cannot approve replenishment policy or raise the frozen starting target",()=>{
  assert.throws(()=>policy(s,{actor:cashier}),/manager_and_reason/);
  assert.throws(()=>call("configure_pos_replenishment",[q(randomUUID()),q(s.allocationId),"true",j([{resourceId:s.ids.portion,maxTarget:27,triggerPercent:50,warnPercent:25,maxTopup:26,approvalAbove:26}]),q(manager),q(reason)]),/invalid_replenishment_policy/);
 });
 policy(s);
 const initialSigned=sql("SELECT budgets::text FROM pos_offline_allocations WHERE id="+q(s.allocationId)+";");
 const sales=[];
 const sell=async(n)=>{const sale=s.make(n,{occurredAt:new Date().toISOString()});const result=await s.post(sale);assert.equal(result.status,200,JSON.stringify(result));sales.push(sale);return sale;};
 await sell(6);
 const above=request(s,journalId);
 check("Above fifty percent remaining no automatic replenishment occurs",()=>{assert.deepEqual(above.resources,[]);assert.equal(s.stock().held,20);});
 const example=request(s,journalId,randomUUID(),manager);
 check("Forty-unit example restores only six consumed units to the original twenty-six target",()=>{assert.equal(example.resources[0].quantity,6);assert.equal(s.stock().held,26);assert.equal(s.stock().finished,8);});
 const same=request(s,journalId,example.id);
 check("Lost funding response retries the identical immutable receipt without a second stock deduction",()=>{assert.deepEqual(same,example);assert.equal(s.stock().finished,8);});
 ack(s,example);
 const movementCount=sql("SELECT count(*) FROM finished_stock_movements;");
 await sell(14);
 check("Settlement after replenishment transfers funded reserved stock without another global deduction",()=>{assert.equal(s.stock().sold,20);assert.equal(s.stock().finished,8);assert.equal(sql("SELECT count(*) FROM finished_stock_movements;"),movementCount);});
 // Remaining allowance is 12: at/below the default 50% trigger. Only eight cloud units exist.
 const partial=request(s,journalId);
 check("Low allocation replenishes only actual available stock, never a new sixty-five-percent calculation",()=>{assert.equal(partial.resources[0].quantity,8);assert.equal(s.stock().finished,0);assert.equal(s.stock().held,20);});
 const pending=request(s,journalId);
 check("Unacknowledged funding blocks another automatic funding operation",()=>{assert.equal(pending.disposition,"activation_pending");assert.deepEqual(pending.resources,[]);});
 // Initial + first activated top-up = 32. Twenty have settled. Unactivated eight must not support more.
 const forged=s.make(13,{sequence:3,occurredAt:new Date().toISOString()});
 const rejected=await s.post(forged);
 check("Cloud settlement cannot spend a reserved but unactivated replenishment",()=>assert.equal(rejected.status,409,JSON.stringify(rejected)));
 ack(s,partial);
 const retryAck=ack(s,partial);
 check("Repeated bridge acknowledgement is idempotent and tied to receipt hash",()=>{assert.equal(retryAck.receiptHash,validation.payloadHash(partial));assert.equal(s.stock().finished,0);});
 const beforeSettlement=s.stock();await sell(5);
 check("Confirmed top-up capacity supports further original-grant cash with unchanged price snapshot",()=>{
  assert.equal(s.stock().sold,25);assert.equal(s.stock().finished,beforeSettlement.finished);assert.equal(sql("SELECT budgets::text FROM pos_offline_allocations WHERE id="+q(s.allocationId)+";"),initialSigned);
 });
 // Synthetic real stock intake: add physical units and the corresponding daily balance/movement.
 sql("UPDATE finished_stock SET current_quantity=current_quantity+10 WHERE portion_type_id="+s.ids.portion+";UPDATE daily_stock SET starting_quantity=starting_quantity+10 WHERE portion_type_id="+s.ids.portion+" AND stock_date="+q(s.grant.serviceDate)+";INSERT INTO finished_stock_movements(portion_type_id,movement_type,quantity_delta,resulting_quantity,note) SELECT portion_type_id,'adjustment',10,current_quantity,'Synthetic replenishment resupply' FROM finished_stock WHERE portion_type_id="+s.ids.portion+";");
 const finalTopup=request(s,journalId,randomUUID(),manager);ack(s,finalTopup);
 check("A later physical resupply does not increase the fixed starting target",()=>{assert.equal(finalTopup.resources[0].quantity,10);assert.equal(s.stock().held,25);assert.equal(s.stock().finished,0);});
 const race=await station("phase3d_race"),raceJournal=bind(race);policy(race);
 const raceSale=race.make(7);assert.equal((await race.post(raceSale)).status,200);
 const raceId=randomUUID(),requestSql="SET ROLE service_role;SELECT request_pos_replenishment("+[q(raceId),q(race.allocationId),q(race.terminalId),q(race.epoch),q(raceJournal),"null","null"].join(",")+");";
 const competitors=await Promise.all([concurrent(requestSql),concurrent("SET ROLE service_role;"+online(race,7))]);
 check("Concurrent online POS and replenishment cannot spend the same shared units",()=>{
  assert.ok(competitors.some(r=>r.code===0));assert.ok(race.stock().finished>=0);assert.equal(race.stock().finished+race.stock().reserved+race.stock().sold,20);
 });
 const managers=await station("phase3d_managers"),managersJournal=bind(managers);policy(managers);assert.equal((await managers.post(managers.make(7))).status,200);
 const managerRequests=await Promise.all([1,2].map(()=>concurrent("SET ROLE service_role;SELECT request_pos_replenishment("+[q(randomUUID()),q(managers.allocationId),q(managers.terminalId),q(managers.epoch),q(managersJournal),q(manager),q(reason)].join(",")+");")));
 check("Concurrent manager funding has at most one funded top-up for the same consumed deficit",()=>{assert.ok(managerRequests.every(r=>r.code===0),JSON.stringify(managerRequests));assert.equal(managers.stock().finished,0);assert.equal(managers.stock().held,13);assert.equal(sql("SELECT count(*) FROM pos_offline_replenishments WHERE allocation_id="+q(managers.allocationId)+" AND revision IS NOT NULL;"),"1");});
 const limited=await station("phase3d_approval"),limitedJournal=bind(limited);policy(limited,{approval:2});assert.equal((await limited.post(limited.make(7))).status,200);
 const capped=request(limited,limitedJournal);
 check("Automatic per-operation quantities stay below the manager-approved automatic limit",()=>assert.equal(capped.resources[0].quantity,2));
 ack(limited,capped);
 const managerMore=request(limited,limitedJournal,randomUUID(),manager);
 check("Larger replenishment needs explicit manager approval and still cannot exceed consumed deficit",()=>{assert.equal(managerMore.resources[0].quantity,5);assert.equal(limited.stock().held,13);});
 // Terminal revocation blocks new funding; historical requests remain retrievable.
 sql("SELECT manage_pos_offline_terminal("+[q(manager),q(limited.terminalId),q(limited.epoch),q("revoke"),q(reason),q(randomUUID())].join(",")+");");
 check("Revocation denies new replenishment but preserves funded evidence and its stable identity",()=>{assert.equal(request(limited,limitedJournal).disposition,"terminal_suspended");assert.deepEqual(request(limited,limitedJournal,managerMore.id),managerMore);});
 const manifests=sales.map(({envelope:e})=>({transactionId:e.transactionId,sequence:e.sequence,payloadHash:validation.payloadHash(e),allocationId:e.allocationId,resources:[{resourceId:s.ids.portion,quantity:e.items[0].quantity}]}));
 const receipts=[example,partial,finalTopup].map(r=>({id:r.id,receiptHash:validation.payloadHash(r)}));
 const closure={version:1,type:"closure",allocationId:s.allocationId,terminalId:s.terminalId,epoch:s.epoch,journalId,sequence:sales.length,closedAt:new Date().toISOString(),manifest:manifests,unused:[{resourceId:s.ids.portion,quantity:25}],fundingReceipts:receipts};
 check("Closure rejects omission of any confirmed top-up from its immutable funding manifest",()=>{
  const bad={...closure,fundingReceipts:receipts.slice(1)};
  assert.throws(()=>sql("SET ROLE service_role;SELECT record_pos_offline_closure("+[j(bad),q(s.signBody(bad)),q(validation.payloadHash(bad))].join(",")+");"),/funding_gap/);
 });
 sql("SET ROLE service_role;SELECT record_pos_offline_closure("+[j(closure),q(s.signBody(closure)),q(validation.payloadHash(closure))].join(",")+");");
 // Fixture-only expiry transition. Production grant/evidence records are never edited by this implementation.
 sql("UPDATE pos_offline_allocations SET expires_at=now()-interval '1 second' WHERE id="+q(s.allocationId)+";");
 call("return_pos_offline_unused",[q(manager),q(s.allocationId),q(reason),q(randomUUID())]);
 check("Closure and safe return include every top-up without double deduction or duplicate return",()=>{
  assert.deepEqual(s.stock(),{finished:25,reserved:0,sold:25,remaining:25,held:0});
  call("return_pos_offline_unused",[q(manager),q(s.allocationId),q(reason),q(randomUUID())]);assert.equal(s.stock().finished,25);
  assert.equal(request(s,journalId).disposition,"allocation_closed_or_expired");
 });
 check("Reporting separates initial funding, top-ups, target, outstanding holds and pending activation",()=>{
  const view=call("get_pos_offline_operations",[q(manager),j({terminal:s.terminalId})]),row=view.allocations.find(a=>a.allocationId===s.allocationId);
  assert.equal(row.initialFunding,26);assert.equal(row.target,26);assert.equal(row.additionalFunding,24);assert.equal(row.funded,50);assert.equal(row.returned,25);
 });
 const reserved=await station("phase3d_reserved");sql("SET ROLE service_role;"+online(reserved,2));
 const otherTerminal=randomUUID(),otherEpoch=randomUUID(),otherAllocation=randomUUID();
 sql("SELECT register_pos_offline_terminal("+[q(otherTerminal),q(otherEpoch),q("p".repeat(43)),q(manager)].join(",")+");SELECT fund_pos_offline_allocation("+[q(otherAllocation),q(otherTerminal),q(otherEpoch),q(randomUUID()),"ARRAY["+reserved.ids.menu+"]::bigint[]","null","least(now()+interval '10 minutes',date_trunc('day',now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala'+interval '1 day'-interval '1 second')",q(manager)].join(",")+");");
 check("Initial 65% excludes already funded holds and normal paid-order commitments",()=>{assert.equal(sql("SELECT quantity_held FROM pos_offline_allocation_resources WHERE allocation_id="+q(otherAllocation)+";"),"4");assert.equal(reserved.stock().finished,1);});
 check("Critical inventory drift remains detectable after replenishment",()=>{
  const critical=()=>Number(sql("SELECT critical_count FROM get_business_truth_health_snapshot(now(),"+q(s.grant.serviceDate)+");"));
  const old=critical();sql("UPDATE finished_stock SET current_quantity=current_quantity+1 WHERE portion_type_id="+s.ids.portion+";");assert.ok(critical()>old);
  sql("UPDATE finished_stock SET current_quantity=current_quantity-1 WHERE portion_type_id="+s.ids.portion+";");
 });

 const shared=await station("phase3d_shared");
 const childId=Number(sql("INSERT INTO portion_types(code,name,stock_source_portion_type_id,stock_source_units_per_serving) VALUES('phase3d_shared_child','Small shared serving',"+shared.ids.portion+",1) RETURNING id;"));
 const childMenu=Number(sql("INSERT INTO menu_items(code,menu_category_id,portion_type_id,name,base_price,prep_type) SELECT 'phase3d_shared_child',menu_category_id,"+childId+",'Shared small',1000,'packed' FROM menu_items WHERE id="+shared.ids.menu+" RETURNING id;"));
 const sharedTerminal=randomUUID(),sharedEpoch=randomUUID(),sharedAllocation=randomUUID(),sharedCatalog=randomUUID();
 sql("SELECT register_pos_offline_terminal("+[q(sharedTerminal),q(sharedEpoch),q("s".repeat(43)),q(manager)].join(",")+");");
 const sharedFundSql=()=> "SELECT fund_pos_offline_allocation("+[q(sharedAllocation),q(sharedTerminal),q(sharedEpoch),q(sharedCatalog),"ARRAY["+shared.ids.menu+","+childMenu+"]::bigint[]","null",q(new Date(shared.grant.expiresAt).toISOString()),q(manager)].join(",")+");";
 const sharedManagers=await Promise.all([concurrent("SET ROLE service_role;"+sharedFundSql()),concurrent("SET ROLE service_role;"+sharedFundSql())]);
 check("Concurrent initial managers cannot fund a shared-source menu representation twice",()=>{
  assert.equal(sharedManagers.filter(r=>r.code===0).length,1);
  const budgets=JSON.parse(sql("SELECT budgets::text FROM pos_offline_allocations WHERE id="+q(sharedAllocation)+";"));
  assert.deepEqual(budgets,[{resourceId:shared.ids.portion,quantity:5}]);
  assert.equal(sql("SELECT count(*) FROM pos_offline_allocation_resources WHERE allocation_id="+q(sharedAllocation)+";"),"1");
  assert.equal(shared.stock().finished,2);
 });
 check("65% minimum and insufficient shared availability fail without changing any funding",()=>{
  const before=shared.stock(),fresh=randomUUID(),epoch=randomUUID();
  sql("SELECT register_pos_offline_terminal("+[q(fresh),q(epoch),q("t".repeat(43)),q(manager)].join(",")+");");
  const fund=budget=>"SELECT fund_pos_offline_allocation("+[q(randomUUID()),q(fresh),q(epoch),q(randomUUID()),"ARRAY["+shared.ids.menu+"]::bigint[]",j([{resourceId:shared.ids.portion,quantity:budget}]),q(new Date(shared.grant.expiresAt).toISOString()),q(manager)].join(",")+");";
  assert.throws(()=>sql(fund(1)),/minimum_65_percent/);
  assert.throws(()=>sql(fund(3)),/insufficient_finished_stock/);
  assert.deepEqual(shared.stock(),before);
 });
 check("Physical rollup reports funding once per source and preserves immutable signed closes",()=>{
  const rows=JSON.parse(sql("SELECT json_agg(t) FROM get_pos_offline_resource_rollup("+q(s.grant.serviceDate)+")t WHERE portion_type_id="+s.ids.portion+";"));
  assert.deepEqual(rows,[{portion_type_id:s.ids.portion,initial_funding:26,additional_funding:24,total_funded:50,cloud_settled:25,returned:25,outstanding_hold:0,verified_unused:25,unresolved_consumption:0}]);
  assert.equal(sql("SELECT count(*) FROM daily_close_snapshots WHERE snapshot IS NULL;"),"0");
  assert.equal(sql("SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]')::text FROM daily_close_snapshots s;"),signedCloseBefore);
 });
 check("Revoked terminals cannot activate previously reserved but unacknowledged funding",()=>{
  assert.throws(()=>ack(limited,managerMore),/terminal_suspended/);
 });

 const paused=await station("phase3d_sync_gating"),pausedJournal=bind(paused);policy(paused);assert.equal((await paused.post(paused.make(7))).status,200);
 terminalReport(paused,pausedJournal,1,true);
 const directRequest=()=>call("request_pos_replenishment",[q(randomUUID()),q(paused.allocationId),q(paused.terminalId),q(paused.epoch),q(pausedJournal),"null","null"]);
 check("Latest unresolved synchronization report blocks replenishment despite an older zero-pending report",()=>assert.equal(directRequest().disposition,"terminal_sync_not_ready"));
 terminalReport(paused,pausedJournal,0,false);
 check("Disabled synchronization cannot obtain new replenishment",()=>assert.equal(directRequest().disposition,"terminal_sync_not_ready"));
 const stale=await station("phase3d_stale"),staleJournal=bind(stale,false);policy(stale);assert.equal((await stale.post(stale.make(7))).status,200);
 const staleBody={version:1,type:"report",reportId:randomUUID(),terminalId:stale.terminalId,epoch:stale.epoch,journalId:staleJournal,sequence:1,reportedAt:new Date(Date.now()-180000).toISOString(),status:{pending_count:0,syncEnabled:true},allocations:[]};
 sql("INSERT INTO pos_offline_terminal_reports(id,terminal_id,epoch,terminal_sequence,body,signature,received_at) VALUES("+[q(staleBody.reportId),q(stale.terminalId),q(stale.epoch),"1",j(staleBody),q(stale.signBody(staleBody)),"now()-interval '3 minutes'"].join(",")+");");
 check("A stale zero-pending terminal cannot reserve more shared stock",()=>assert.equal(call("request_pos_replenishment",[q(randomUUID()),q(stale.allocationId),q(stale.terminalId),q(stale.epoch),q(staleJournal),"null","null"]).disposition,"terminal_sync_not_ready"));
 check("Replenishment records and operations stay service-only with real RLS and ACLs",()=>{
  for(const table of ["pos_offline_replenishments","pos_offline_replenishment_acks","pos_offline_replenishment_policies"])for(const role of ["anon","authenticated","service_role"])assert.equal(sql("SELECT has_table_privilege("+q(role)+","+q(table)+",'INSERT');"),"f");
  assert.throws(()=>sql("UPDATE pos_offline_replenishments SET receipt='{}' WHERE id="+q(example.id)+";"),/immutable/);
 });

}
