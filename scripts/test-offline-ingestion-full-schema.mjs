import assert from "node:assert/strict";
import {generateKeyPairSync,randomUUID,sign} from "node:crypto";
import {SignJWT,calculateJwkThumbprint} from "jose";
import {loadTs} from "../tests/pos-test-loader.mjs";

// Real endpoint validation and real PostgreSQL RPC. Only NextResponse/PostgREST
// transport is adapted to native Response/local psql; no financial table mocks.
export async function testOfflineIngestion({sql,check,manager,cashier,today,expiry,health,concurrent}) {
 const validation=loadTs("lib/pos/offline-ingestion.ts",{"server-only":{}});
 const {canonical,payloadHash}=validation;
 const cloud=generateKeyPairSync("ed25519");
 const names=["POS_OFFLINE_SYNC_ENABLED","POS_OFFLINE_GRANT_PRIVATE_JWK_B64","POS_OFFLINE_GRANT_ISSUER"];
 const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 process.env.POS_OFFLINE_SYNC_ENABLED="true";
 process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64=Buffer.from(JSON.stringify(cloud.privateKey.export({format:"jwk"}))).toString("base64url");
 process.env.POS_OFFLINE_GRANT_ISSUER="fullschema-offline-test";
 const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
 const json=v=>quote(JSON.stringify(v))+"::jsonb";
 const database={
   from(table){assert.equal(table,"pos_offline_terminals");const filters={};
     return {select(){return this;},eq(key,value){filters[key]=value;return this;},
       async maybeSingle(){return {data:JSON.parse(sql("SELECT coalesce((SELECT json_build_object('terminal_key',terminal_key) FROM pos_offline_terminals WHERE terminal_id="+quote(filters.terminal_id)+" AND epoch="+quote(filters.epoch)+"),'null'::json);")),error:null};}
     };
   },
   async rpc(name,p){assert.equal(name,"ingest_pos_offline_cash_sale");
     try{return {data:JSON.parse(sql("SET ROLE service_role; SELECT ingest_pos_offline_cash_sale("+json(p.p_envelope)+","+quote(p.p_signature)+","+quote(p.p_payload_hash)+","+json(p.p_grant)+");")),error:null};}
     catch(error){return {data:null,error:{code:/duplicate key/.test(error.message)?"23505":"P0001",message:/offline_[a-z_]+/.exec(error.message)?.[0]||"database_failure"}};}
   }
 };
 const {POST}=loadTs("app/api/admin/pos/offline/ingest/route.ts",{
   "next/server":{NextResponse:{json:(body,init)=>Response.json(body,init)}},
   "@/lib/supabase/server":{createAdminSupabaseClient:()=>database},
   "@/lib/pos/offline-ingestion":validation
 });
 async function station(code,offset=0,startingStock=20){
   const terminal=generateKeyPairSync("ed25519"),publicJwk=terminal.publicKey.export({format:"jwk"});
   const terminalId=randomUUID(),epoch=randomUUID(),allocationId=randomUUID(),catalogVersion=randomUUID();
   const key=await calculateJwkThumbprint(publicJwk);
   sql("INSERT INTO portion_types(code,name) VALUES("+quote(code)+",'Full schema smoked ribs');"+
     "INSERT INTO menu_items(code,menu_category_id,portion_type_id,name,base_price,prep_type) SELECT "+quote(code)+",(SELECT id FROM menu_categories WHERE code='phase103_test'),id,'Ribs – smoked',2000,'packed' FROM portion_types WHERE code="+quote(code)+";"+
     "INSERT INTO finished_stock(portion_type_id,current_quantity) SELECT id,"+startingStock+" FROM portion_types WHERE code="+quote(code)+";"+
     "INSERT INTO finished_stock_movements(portion_type_id,movement_type,quantity_delta,resulting_quantity,note) SELECT id,'adjustment',"+startingStock+","+startingStock+",'Synthetic initial stock' FROM portion_types WHERE code="+quote(code)+";");
   const ids=JSON.parse(sql("SELECT json_build_object('portion',p.id,'menu',m.id) FROM portion_types p JOIN menu_items m ON m.portion_type_id=p.id WHERE p.code="+quote(code)+";"));
   sql("SELECT register_pos_offline_terminal("+quote(terminalId)+","+quote(epoch)+","+quote(key)+","+quote(manager)+");"+
     "SELECT fund_pos_offline_allocation("+quote(allocationId)+","+quote(terminalId)+","+quote(epoch)+","+quote(catalogVersion)+",ARRAY["+ids.menu+"]::bigint[],null,"+expiry+","+quote(manager)+");");
   if(offset){
     // Simulate a genuinely funded prior-day allocation by shifting this fixture's
     // funding clock and daily row together. Never a production operation.
     sql("UPDATE pos_offline_allocations SET service_date=service_date-"+offset+",funded_at=funded_at-interval '"+offset+" days',expires_at=expires_at-interval '"+offset+" days' WHERE id="+quote(allocationId)+";"+
       "UPDATE daily_stock SET stock_date=stock_date-"+offset+" WHERE portion_type_id="+ids.portion+";");
   }
   const a=JSON.parse(sql("SELECT json_build_object('serviceDate',service_date,'expiresAt',floor(extract(epoch from expires_at)*1000),'items',items,'budgets',budgets) FROM pos_offline_allocations WHERE id="+quote(allocationId)+";"));
   const captured=Date.now()-offset*86400000,issuedAt=Math.floor((captured-10000)/1000)*1000;
   const grant={version:1,grantId:randomUUID(),terminalId,epoch,terminalKey:key,cashierId:cashier,permissions:["cash","reprint"],allocationId,catalogVersion,...a,issuedAt};
   const token=await new SignJWT({grant}).setProtectedHeader({alg:"EdDSA"}).setIssuer("fullschema-offline-test").setAudience("smokehouse-offline-pos-v1")
     .setIssuedAt(issuedAt/1000).setExpirationTime(grant.expiresAt/1000).sign(cloud.privateKey);
   let sequence=0;
   function make(quantity=1,changes={}){
     const seq=changes.sequence||++sequence;
     const items=grant.items.map(i=>({...i,quantity,total:i.unitPrice*quantity})),total=quantity*2000;
     const id=changes.transactionId||randomUUID(),occurredAt=changes.occurredAt||new Date(captured).toISOString();
     const receipt={saleId:"L-"+terminalId.slice(0,8)+"-"+epoch.slice(0,8)+"-"+String(seq).padStart(6,"0"),date:occurredAt,
       items:items.map(({name,quantity,unitPrice,total})=>({name,quantity,unitPrice,total})),subtotal:total,total,paymentMethod:"cash"};
     const e={version:1,transactionId:id,terminalId,epoch,sequence:seq,cashierId:cashier,grantId:grant.grantId,authorization:token,
       allocationId,catalogVersion,occurredAt,serviceDate:grant.serviceDate,amountReceived:quantity*5000,changeGiven:quantity*3000,items,receipt,
       inputHash:payloadHash({transactionId:id,catalogVersion,expectedTotal:total,amountReceived:quantity*5000,items:[{menuItemId:ids.menu,quantity}]})};
     return seal(e);
   }
   function seal(envelope){return {envelope,signature:sign(null,Buffer.from(canonical(envelope)),terminal.privateKey).toString("base64url"),publicJwk};}
   async function post(sale,ageSeconds=0){
     const e=sale.envelope,now=Math.floor(Date.now()/1000)-ageSeconds;
     const proof=await new SignJWT({terminalId:e.terminalId,epoch:e.epoch,payloadHash:payloadHash(e)}).setProtectedHeader({alg:"EdDSA"}).setIssuer(e.terminalId)
       .setAudience("smokehouse-offline-sync-v1").setIssuedAt(now).setExpirationTime(now+60).sign(terminal.privateKey);
     const response=await POST(new Request("https://admin.test/api/admin/pos/offline/ingest",{method:"POST",headers:{Authorization:"Bearer "+proof,"Content-Type":"application/json"},body:JSON.stringify(sale)}));
     return {status:response.status,body:await response.json()};
   }
   function stock(){return JSON.parse(sql("SELECT json_build_object('finished',f.current_quantity,'reserved',d.reserved_quantity,'sold',d.sold_quantity,'remaining',d.remaining_quantity,'held',(SELECT held_quantity FROM get_pos_offline_allocation_holds("+quote(grant.serviceDate)+") WHERE portion_type_id="+ids.portion+")) FROM finished_stock f JOIN daily_stock d ON d.portion_type_id=f.portion_type_id AND d.stock_date="+quote(grant.serviceDate)+" WHERE f.portion_type_id="+ids.portion+";"));}
   return {grant,make,seal,post,stock,ids,terminalId,epoch,allocationId,publicJwk,signBody:body=>sign(null,Buffer.from(canonical(body)),terminal.privateKey).toString("base64url"),
 operationsProof:body=>new SignJWT({terminalId,epoch,payloadHash:payloadHash(body)}).setProtectedHeader({alg:"EdDSA"}).setIssuer(terminalId).setAudience("smokehouse-offline-operations-v1").setIssuedAt().setExpirationTime("60s").sign(terminal.privateKey)};
 }
 function totals(){return sql("SELECT json_build_object('orders',(SELECT count(*) FROM orders),'tenders',(SELECT count(*) FROM pos_tenders),'ingestions',(SELECT count(*) FROM pos_offline_ingestions),'settlements',(SELECT count(*) FROM pos_offline_stock_settlements),'events',(SELECT count(*) FROM order_status_events),'audit',(SELECT count(*) FROM staff_activity_log));");}
 try{
   const s=await station("phase3b_main");
   const original=s.make(4),beforeMovements=sql("SELECT count(*) FROM finished_stock_movements;");
   sql("UPDATE menu_items SET base_price=9999,is_active=false,is_available_today=false WHERE id="+s.ids.menu+";");
   const first=await s.post(original);
   check("Phase 3B signed single-sale endpoint creates canonical order and partial settlement",()=>{
     assert.equal(first.status,200,JSON.stringify(first.body));const a=first.body.acknowledgement;
     assert.equal(a.disposition,"acknowledged");assert.deepEqual(a.settlement,[{resourceId:s.ids.portion,quantity:4}]);
     assert.deepEqual(s.stock(),{finished:13,reserved:3,sold:4,remaining:13,held:3});assert.equal(health().critical_count,0);
   });
   check("Historical price, amount received, change and capture date survive current catalog edits",()=>{
     const a=first.body.acknowledgement;
     const row=JSON.parse(sql("SELECT json_build_object('unit',i.unit_price,'total',o.total_amount,'received',t.amount_received,'change',t.change_given,'day',o.service_date,'captured',t.captured_at=o.paid_at) FROM orders o JOIN order_items i ON i.order_id=o.id JOIN pos_tenders t ON t.order_id=o.id WHERE o.id="+a.orderId+";"));
     assert.deepEqual(row,{unit:2000,total:8000,received:20000,change:12000,day:s.grant.serviceDate,captured:true});
   });
   const beforeRenewal=totals(),expiredProof=await s.post(original,120);
   check("Expired delivery proof requests renewal without quarantining a valid captured sale",()=>{
     assert.equal(expiredProof.status,401);assert.equal(totals(),beforeRenewal);
   });
   const beforeRepeat=totals(),repeat=await s.post(original);
   check("Lost cloud acknowledgement and identical replay return the exact durable acknowledgement",()=>{
     assert.deepEqual(repeat,first);assert.equal(totals(),beforeRepeat);
   });
   let modified=structuredClone(original.envelope);modified.amountReceived+=1000;modified.changeGiven+=1000;
   modified.inputHash=payloadHash({transactionId:modified.transactionId,catalogVersion:modified.catalogVersion,expectedTotal:8000,amountReceived:modified.amountReceived,items:[{menuItemId:s.ids.menu,quantity:4}]});
   const changed=await s.post(s.seal(modified)),sequenceReuse=await s.post(s.make(1,{sequence:1}));
   check("Modified identity and duplicate terminal sequence/receipt are rejected with zero financial effects",()=>{
     assert.equal(changed.status,409);assert.equal(sequenceReuse.status,409);assert.equal(totals(),beforeRepeat);
   });
   const full=await s.post(s.make(3));
   check("Complete settlement exhausts only the original allocation and does not deduct finished stock twice",()=>{
     assert.equal(full.status,200,JSON.stringify(full.body));assert.deepEqual(s.stock(),{finished:13,reserved:0,sold:7,remaining:13,held:0});
     assert.equal(sql("SELECT count(*) FROM finished_stock_movements;"),beforeMovements);
     assert.equal(health().critical_count,0);
   });
   const beforeExcess=totals(),excess=await s.post(s.make(1));
   check("Allocation overconsumption rolls back order, tender, identity and audit effects",()=>{
     assert.equal(excess.status,409);assert.equal(totals(),beforeExcess);assert.equal(s.stock().held,0);
   });
   const invalid=s.make(1);invalid.signature="x".repeat(86);
   const badSignature=await s.post(invalid);
   const wrongEpoch=structuredClone(original.envelope);wrongEpoch.epoch=randomUUID();
   const epochResult=await s.post(s.seal(wrongEpoch));
   const expired=structuredClone(original.envelope);
   const expiredAt=Math.floor((Date.parse(expired.occurredAt)-1000)/1000)*1000;
   expired.authorization=await new SignJWT({grant:{...s.grant,expiresAt:expiredAt}}).setProtectedHeader({alg:"EdDSA"}).setIssuer("fullschema-offline-test")
     .setAudience("smokehouse-offline-pos-v1").setIssuedAt(s.grant.issuedAt/1000).setExpirationTime(expiredAt/1000).sign(cloud.privateKey);
   const expiryResult=await s.post(s.seal(expired));
   check("Invalid terminal signature, epoch binding and capture-time grant expiry fail closed",()=>{
     assert.equal(badSignature.status,422);assert.equal(epochResult.status,422);assert.equal(expiryResult.status,403);
     assert.equal(totals(),beforeExcess);
   });
   const cash=structuredClone(original.envelope);cash.amountReceived=1;
   const invalidCash=await s.post(s.seal(cash));
   check("Incorrect cash tender is rejected without repricing or changing financial evidence",()=>{
     assert.equal(invalidCash.status,422);assert.equal(totals(),beforeExcess);
   });
   const disabledSale=s.make(1);
   sql("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id="+quote(cashier)+";");
   const disabled=await s.post(disabledSale);
   sql("UPDATE auth.users SET banned_until=null WHERE id="+quote(cashier)+";");
   check("Cashier disabled after capture produces immutable review evidence without new financial effects",()=>{
     assert.equal(disabled.status,200);assert.equal(disabled.body.acknowledgement.reason,"cashier_authorization_changed");
     assert.ok(!disabled.body.acknowledgement.orderId);assert.equal(s.stock().held,0);
     assert.equal(sql("SELECT count(*) FROM pos_offline_ingestions WHERE transaction_id="+quote(disabledSale.envelope.transactionId)+";"),"1");
   });
   sql("UPDATE pos_offline_terminals SET enabled=false WHERE terminal_id="+quote(s.terminalId)+";");
   const revoked=await s.post(s.make(1)),oldRepeat=await s.post(original);
   sql("UPDATE pos_offline_terminals SET enabled=true WHERE terminal_id="+quote(s.terminalId)+";");
   check("Revoked terminal retains original evidence for review while accepted duplicates remain canonical",()=>{
     assert.equal(revoked.body.acknowledgement.reason,"terminal_authorization_changed");assert.deepEqual(oldRepeat,first);
   });
   check("Unexplained daily-stock drift is still critical after settlement",()=>{
     try{sql("UPDATE daily_stock SET sold_quantity=sold_quantity-1 WHERE portion_type_id="+s.ids.portion+" AND stock_date="+quote(s.grant.serviceDate)+";");
       assert.equal(health().sections.find(x=>x.key==="daily_stock_drift").count,1);
     }finally{sql("UPDATE daily_stock SET sold_quantity=sold_quantity+1 WHERE portion_type_id="+s.ids.portion+" AND stock_date="+quote(s.grant.serviceDate)+";");}
     assert.equal(health().critical_count,0);
   });
   check("Ingested orders, items, tenders and settlement acknowledgements are immutable",()=>{
     const id=first.body.acknowledgement.orderId;
     for(const statement of ["UPDATE orders SET status='cancelled' WHERE id="+id,"SELECT finalize_reserved_order_sale("+id+")",
       "UPDATE order_items SET unit_price=1 WHERE order_id="+id,"DELETE FROM pos_tenders WHERE order_id="+id,
       "UPDATE pos_offline_stock_settlements SET quantity=1 WHERE order_id="+id,
       "UPDATE pos_offline_ingestions SET acknowledgement='{}' WHERE order_id="+id]){
       assert.throws(()=>sql(statement+";"),/immutable/);
     }
   });
   const rollback=await station("phase3b_rollback"),sale=rollback.make(2);
   sql("CREATE FUNCTION phase3b_fail_tender() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF new.order_id IN (SELECT id FROM orders WHERE notes LIKE 'Offline cash sale L-"+rollback.terminalId.slice(0,8)+"%') THEN RAISE EXCEPTION 'phase3b_injected_failure'; END IF; RETURN new; END; $$; CREATE TRIGGER phase3b_fail_tender BEFORE INSERT ON pos_tenders FOR EACH ROW EXECUTE FUNCTION phase3b_fail_tender();");
   const before=totals(),stockBefore=rollback.stock(),failure=await rollback.post(sale);
   sql("DROP TRIGGER phase3b_fail_tender ON pos_tenders; DROP FUNCTION phase3b_fail_tender();");
   check("Failure after allocation transfer atomically rolls back every financial and stock effect",()=>{
     assert.equal(failure.status,503);assert.equal(totals(),before);assert.deepEqual(rollback.stock(),stockBefore);
   });
   const afterRetry=await rollback.post(sale);
   check("Retry after a definite database rollback succeeds with the original immutable envelope",()=>{
     assert.equal(afterRetry.status,200);assert.equal(rollback.stock().held,5);
   });
   const raceStation=await station("phase3b_ingestion_race");
   const raceSale=raceStation.make(2);
   const rpcSql=sale=>"SET ROLE service_role; SELECT ingest_pos_offline_cash_sale("+json(sale.envelope)+","+quote(sale.signature)+","+quote(payloadHash(sale.envelope))+","+json(raceStation.grant)+");";
   const orderCount=Number(sql("SELECT count(*) FROM orders;"));
   const deliveries=await Promise.all(Array.from({length:4},()=>concurrent(rpcSql(raceSale))));
   check("Concurrent identical ingestion has exactly one order, tender and settlement effect",()=>{
     assert.ok(deliveries.every(r=>r.code===0),JSON.stringify(deliveries));
     assert.equal(Number(sql("SELECT count(*) FROM orders;")),orderCount+1);
     assert.equal(raceStation.stock().sold,2);assert.equal(raceStation.stock().held,5);
   });
   const competing=await Promise.all([raceStation.make(4),raceStation.make(4)].map(sale=>concurrent(rpcSql(sale))));
   check("Concurrent distinct offline sales cannot overconsume a funded allocation",()=>{
     assert.equal(competing.filter(r=>r.code===0).length,1);
     assert.match(competing.find(r=>r.code!==0).error,/offline_allocation_overconsumed/);
     assert.deepEqual(raceStation.stock(),{finished:13,reserved:1,sold:6,remaining:13,held:1});
     assert.equal(health().critical_count,0);
   });
   check("Database independently recomputes the immutable payload hash",()=>{
     const before=totals();
     assert.throws(()=>sql("SET ROLE service_role; SELECT ingest_pos_offline_cash_sale("+json(raceSale.envelope)+","+quote(raceSale.signature)+","+quote("x".repeat(43))+","+json(raceStation.grant)+");"),/offline_payload_hash_mismatch/);
     assert.equal(totals(),before);
   });
   const prior=await station("phase3b_prior_open",2),priorResult=await prior.post(prior.make(2));
   check("Cross-day ingestion preserves original Kampala service date and cash collection",()=>{
     assert.equal(priorResult.status,200,JSON.stringify(priorResult.body));
     const a=priorResult.body.acknowledgement;assert.equal(a.disposition,"acknowledged");
     assert.equal(sql("SELECT service_date::text FROM orders WHERE id="+a.orderId+";"),prior.grant.serviceDate);
     assert.equal(Number(sql("SELECT cash_sales_ugx FROM get_daily_cash_reconciliation("+quote(prior.grant.serviceDate)+",0);")),4000);
     assert.equal(Number(sql("SELECT critical_count FROM get_business_truth_health_snapshot(now(),"+quote(prior.grant.serviceDate)+");")),0);
   });
   const late=await station("phase3b_prior_closed",1);
   const closeBefore=sql("SELECT snapshot::text FROM daily_close_snapshots WHERE service_date="+quote(late.grant.serviceDate)+";");
   const lateResult=await late.post(late.make(1));
   check("Signed daily close remains unchanged; late sale creates additive needs-review adjustment",()=>{
     assert.equal(lateResult.status,200,JSON.stringify(lateResult.body));assert.equal(lateResult.body.acknowledgement.disposition,"needs_review");
     assert.equal(lateResult.body.acknowledgement.reason,"signed_close_adjustment_required");
     assert.equal(sql("SELECT snapshot::text FROM daily_close_snapshots WHERE service_date="+quote(late.grant.serviceDate)+";"),closeBefore);
     assert.equal(sql("SELECT count(*) FROM pos_offline_close_adjustments WHERE order_id="+lateResult.body.acknowledgement.orderId+" AND state='needs_review';"),"1");
   });
   check("Ingestion and settlement evidence remain inaccessible for direct browser writes",()=>{
     for(const table of ["pos_offline_ingestions","pos_offline_stock_settlements","pos_offline_close_adjustments"])
       for(const role of ["anon","authenticated","service_role"])assert.equal(sql("SELECT has_table_privilege("+quote(role)+","+quote("public."+table)+",'INSERT');"),"f");
     for(const role of ["anon","authenticated"])assert.equal(sql("SELECT has_function_privilege("+quote(role)+",'public.ingest_pos_offline_cash_sale(jsonb,text,text,jsonb)','EXECUTE');"),"f");
     assert.match(sql("SELECT pg_get_functiondef('public.sign_off_daily_close_v2(date,bigint,bigint,text,uuid,jsonb)'::regprocedure);"),/offline-close:/);
     assert.equal(sql("SELECT count(*) FROM online_receipt_print_jobs;"),"0");
   });
 await (await import("./test-offline-operations-full-schema.mjs")).testOfflineOperations({sql,check,station,manager,cashier,concurrent,validation});
 await (await import("./test-offline-replenishment-full-schema.mjs")).testOfflineReplenishment({sql,check,station,manager,cashier,concurrent,validation});
 }finally{for(const n of names){if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];}}
}
