import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {spawnSync,spawn} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import assert from "node:assert/strict";

const snapshot=path.resolve(process.argv[2]||"");
if(!process.argv[2]||!fs.existsSync(path.join(snapshot,"schema.sql")))throw Error("Provide a schema-only snapshot directory; this runner never connects to Supabase.");
const metadata=JSON.parse(fs.readFileSync(path.join(snapshot,"metadata.json"),"utf8"));
const schemaFile=path.join(snapshot,fs.existsSync(path.join(snapshot,"schema-owned.sql"))?"schema-owned.sql":"schema.sql");
const bin=process.env.POSTGRES_TEST_BIN||"C:/Program Files/PostgreSQL/18/bin";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"smokehouse-full-schema-test-")),data=path.join(root,"data");
const server=net.createServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));
const port=server.address().port;await new Promise(r=>server.close(r));
const env={...process.env,PGHOST:"127.0.0.1",PGHOSTADDR:"127.0.0.1",PGPORT:String(port),PGUSER:"offline_fixture",PGDATABASE:"postgres",PGPASSWORD:"",PGCONNECT_TIMEOUT:"5",PGSSLMODE:"disable"};
delete env.PGSERVICE;delete env.PGOPTIONS;
const evidence={sourceVersion:metadata.version,localVersion:"18",schemaSha256:createHash("sha256").update(fs.readFileSync(schemaFile)).digest("hex"),sourcePhase103Present:metadata.phase103Present,ownershipPreserved:fs.existsSync(path.join(snapshot,"schema-owned.sql")),tests:[],platformAdapters:[]};
function run(tool,args,input){const result=spawnSync(path.join(bin,tool+".exe"),args,{env,input,encoding:"utf8",windowsHide:true,...(tool==="pg_ctl"?{stdio:"ignore"}:{}),timeout:180000,maxBuffer:12*1024*1024});if(result.status!==0||result.error)throw Error(tool+": "+(result.stderr||result.error));return result.stdout||"";}
function sql(input){return run("psql",["-X","-w","-q","-A","-t","-v","ON_ERROR_STOP=1"],input).trim();}
function ident(value){return '"'+value.replaceAll('"','""')+'"';}
function pass(name,detail){evidence.tests.push({name,status:"PASS",detail});console.log("PASS "+name);}
let started=false;
try{
 run("initdb",["-D",data,"-A","trust","-U","offline_fixture","--encoding=UTF8","--no-locale","--no-sync","--no-instructions"]);
 started=true;run("pg_ctl",["-D",data,"-l",path.join(root,"postgres.log"),"-o","-h 127.0.0.1 -p "+port,"-w","-t","30","start"]);
 for(const role of metadata.roles)sql("CREATE ROLE "+ident(role.name)+" NOLOGIN "+(role.bypassRls?"BYPASSRLS":"NOBYPASSRLS")+" "+(role.superuser?"SUPERUSER":"NOSUPERUSER")+" "+(role.inherit===false?"NOINHERIT":"INHERIT")+" "+(role.createRole?"CREATEROLE":"NOCREATEROLE")+" "+(role.createDb?"CREATEDB":"NOCREATEDB")+" "+(role.replication?"REPLICATION":"NOREPLICATION")+";");
 for(const member of metadata.memberships||[])sql("GRANT "+ident(member.role)+" TO "+ident(member.member)+" WITH ADMIN "+member.admin+", INHERIT "+member.inherit+", SET "+member.set+";");
 sql("DROP SCHEMA public CASCADE; CREATE SCHEMA extensions;");
 for(const extension of metadata.extensions){
  if(extension.name==="plpgsql")continue;
  const available=sql("SELECT count(*) FROM pg_available_extensions WHERE name='"+extension.name.replaceAll("'","''")+"';")==="1";
  if(available)sql("CREATE SCHEMA IF NOT EXISTS "+ident(extension.schema)+"; CREATE EXTENSION "+ident(extension.name)+" WITH SCHEMA "+ident(extension.schema)+";");
  else evidence.platformAdapters.push({extension:extension.name,status:"not installed locally; no stub used"});
 }
 sql(fs.readFileSync(schemaFile,"utf8"));
 pass("Restore full public/auth schema with constraints, RLS, ACLs and triggers",sql("SELECT json_build_object('tables',(SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','auth')),'triggers',(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal));"));
 sql("ALTER DATABASE postgres OWNER TO postgres;");
 const before=sql("SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('create_pos_sale','create_pos_sale_with_receipt','reserve_paid_order_stock','get_business_truth_health_snapshot','get_daily_cash_reconciliation');");
 if(!metadata.phase103Present){
  const migration=fs.readFileSync("db/phase-103-offline-pos-foundations.sql","utf8");
  const rollbackBody=migration.replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  sql("SET ROLE postgres; BEGIN;\n"+rollbackBody+"\nROLLBACK;");
  assert.equal(sql("SELECT to_regclass('public.pos_offline_terminals') IS NULL;"),"t");
  pass("DDL rollback leaves no Phase 103 tables or functions");
  sql("SET ROLE postgres;\n"+migration);
 }
 const after=sql("SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('create_pos_sale','create_pos_sale_with_receipt','reserve_paid_order_stock','get_business_truth_health_snapshot','get_daily_cash_reconciliation');");
 assert.equal(after,before);pass("Phase 103 applies without replacing existing POS, stock or reconciliation functions");

 const preservedSql="SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('create_pos_sale','create_pos_sale_with_receipt','reserve_paid_order_stock','get_daily_cash_reconciliation');";
 const preserved=sql(preservedSql);
 const legacyOid=sql("SELECT 'public.get_daily_menu_stock(date)'::regprocedure::oid;");
 const legacyColumns=sql("SELECT array_to_json(proargnames) FROM pg_proc WHERE oid='public.get_daily_menu_stock(date)'::regprocedure;");
 for(const file of ["db/phase-104-order-number-width.sql","db/phase-105-offline-allocation-reporting.sql"]){
  const migration=fs.readFileSync(file,"utf8");
  sql("SET ROLE postgres; BEGIN;\n"+migration.replace(/^begin;$/m,"").replace(/^commit;$/m,"")+"\nROLLBACK;");
  assert.equal(sql(preservedSql),preserved);
  assert.equal(sql("SELECT 'public.get_daily_menu_stock(date)'::regprocedure::oid;"),legacyOid);
  sql("SET ROLE postgres;\n"+migration);
 }
 assert.equal(sql(preservedSql),preserved);
 assert.equal(sql("SELECT 'public.get_daily_menu_stock_phase103_base(date)'::regprocedure::oid;"),legacyOid);
 const nextColumns=JSON.parse(sql("SELECT array_to_json(proargnames) FROM pg_proc WHERE oid='public.get_daily_menu_stock(date)'::regprocedure;"));
 assert.deepEqual(nextColumns.slice(0,14),JSON.parse(legacyColumns));
 pass("Forward migrations roll back cleanly, preserve financial functions and legacy daily-stock OID/columns");
 for(const file of ["db/phase-106-offline-cash-ingestion.sql","db/phase-107-offline-settlement-reporting.sql","db/phase-108-offline-operations.sql","db/phase-109-offline-reconciliation.sql","db/phase-110-offline-management-views.sql","db/phase-111-offline-supervised-recovery.sql","db/phase-112-offline-issuance-integrity.sql"]){
  const migration=fs.readFileSync(file,"utf8");
  sql("SET ROLE postgres; BEGIN;\n"+migration.replace(/^begin;$/m,"").replace(/^commit;$/m,"")+"\nROLLBACK;");
  assert.equal(sql(preservedSql),preserved);
  sql("SET ROLE postgres;\n"+migration);
 }
 pass("Phase 106–107 compile and roll back against full schema without changing existing online financial functions");
 const manager=randomUUID(),cashier=randomUUID();
 sql(`INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('${manager}','manager@phase103.invalid','{"role":"manager","provisioned_by_admin":true}'),
 ('${cashier}','cashier@phase103.invalid','{"role":"cashier","provisioned_by_admin":true}');
 INSERT INTO public.profiles(id,email,role) VALUES('${manager}','manager@phase103.invalid','manager'),
 ('${cashier}','cashier@phase103.invalid','cashier') ON CONFLICT(id) DO UPDATE SET role=excluded.role;
 INSERT INTO public.menu_categories(code,name) VALUES('phase103_test','Phase 103 synthetic test');
 INSERT INTO public.portion_types(code,name) VALUES('phase103_main','Synthetic main'),('phase103_second','Synthetic second'),
 ('phase103_empty','Synthetic empty'),('phase103_race','Synthetic race'),('phase103_other','Synthetic other');
 INSERT INTO public.menu_items(code,menu_category_id,portion_type_id,name,base_price,prep_type)
 SELECT p.code,(SELECT id FROM menu_categories WHERE code='phase103_test'),p.id,p.name,2000,'packed'
 FROM public.portion_types p WHERE p.code LIKE 'phase103_%';
 INSERT INTO public.finished_stock(portion_type_id,current_quantity)
 SELECT id,case when code='phase103_empty' then 0 else 20 end FROM portion_types WHERE code LIKE 'phase103_%';
 INSERT INTO public.finished_stock_movements(portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
 SELECT portion_type_id,'adjustment',current_quantity,current_quantity,'Synthetic starting stock'
 FROM finished_stock WHERE current_quantity>0;`);
 const ids=JSON.parse(sql("SELECT json_object_agg(p.code,json_build_object('portion',p.id,'menu',m.id)) FROM portion_types p JOIN menu_items m ON m.portion_type_id=p.id WHERE p.code LIKE 'phase103_%';"));
 const today="(now() at time zone 'Africa/Kampala')::date";
 const expiry="least(now()+interval '30 minutes',((now() at time zone 'Africa/Kampala')::date+time '23:59:59') at time zone 'Africa/Kampala')";
 const key="x".repeat(43),terminals=Array.from({length:9},()=>({id:randomUUID(),epoch:randomUUID()}));
 for(const t of terminals)sql(`SELECT register_pos_offline_terminal('${t.id}','${t.epoch}','${key}','${manager}');`);
 function stock(code){return JSON.parse(sql(`SELECT json_build_object('finished',f.current_quantity,'reserved',coalesce(d.reserved_quantity,0),'remaining',coalesce(d.remaining_quantity,f.current_quantity))
 FROM finished_stock f LEFT JOIN daily_stock d ON d.portion_type_id=f.portion_type_id AND d.stock_date=${today}
 WHERE f.portion_type_id=${ids[code].portion};`));}
 function totals(){return JSON.parse(sql("SELECT json_build_object('orders',(SELECT count(*) FROM orders),'tenders',(SELECT count(*) FROM pos_tenders),'requests',(SELECT count(*) FROM pos_sale_requests),'allocations',(SELECT count(*) FROM pos_offline_allocations),'resources',(SELECT count(*) FROM pos_offline_allocation_resources),'movements',(SELECT count(*) FROM finished_stock_movements));"));}
 function funding(t,codes,budgets=null,id=randomUUID()){
  return {id,statement:`SELECT fund_pos_offline_allocation('${id}','${t.id}','${t.epoch}','${randomUUID()}',ARRAY[${codes.map(code=>ids[code].menu).join(",")}]::bigint[],${budgets===null?"null":"'"+JSON.stringify(budgets)+"'::jsonb"},${expiry},'${manager}');`};
 }
 function online(code,quantity,identity=randomUUID()){
  const input=JSON.stringify([{menu_item_id:ids[code].menu,quantity}]);
  return `SELECT create_pos_sale_with_receipt('${identity}','${"a".repeat(64)}','${cashier}','cash',${quantity*2000},null,'${input}'::jsonb);`;
 }
 function health(){return JSON.parse(sql(`SELECT row_to_json(h) FROM get_business_truth_health_snapshot(now(),${today}) h;`));}
 function check(name,work){
  try{const detail=work();pass(name,detail);}
  catch(error){evidence.tests.push({name,status:"FAIL",detail:error.message});console.log("FAIL "+name+": "+error.message);process.exitCode=1;}
 }
 check("Full-schema synthetic setup and baseline stock reconciliation",()=>{
  assert.equal(health().critical_count,0);return totals();
 });
 check("Existing order numbering remains unique beyond three digits",()=>{
  for(const [start,expected] of [[998,["998","999","1000","1001"]],[1,["001","002"]],[999999,["999999","1000000"]]]){
   sql("ALTER SEQUENCE public.order_number_seq RESTART WITH "+start+";");
   const numbers=JSON.parse(sql("SELECT json_agg(public.generate_order_number()) FROM generate_series(1,"+expected.length+");"));
   assert.deepEqual(numbers,expected);assert.equal(new Set(numbers).size,numbers.length);
  }
 });
 // Empty-fixture sequence state only. Preserve the actual generator/function; no production sequence is read or advanced.
 sql("ALTER SEQUENCE public.order_number_seq RESTART WITH 1;");
 const beforeSale=totals();
 const originalKey=randomUUID();
 const firstReceipt=JSON.parse(sql(online("phase103_main",3,originalKey)));
 check("Existing Phase 2 RPC runs with real order/payment/stock triggers",()=>{
  assert.equal(firstReceipt.totalAmount,6000);assert.equal(stock("phase103_main").finished,17);
  assert.equal(totals().orders,beforeSale.orders+1);assert.equal(totals().tenders,beforeSale.tenders+1);
  const again=JSON.parse(sql(online("phase103_main",3,originalKey)));assert.equal(again.orderId,firstReceipt.orderId);
  assert.equal(totals().orders,beforeSale.orders+1);assert.equal(health().critical_count,0);
 });
 const beforeFunding=totals(),firstAllocation=funding(terminals[0],["phase103_main"]);
 sql(firstAllocation.statement);
 check("35% minimum uses stock remaining after existing paid reservations",()=>{
  assert.deepEqual(stock("phase103_main"),{finished:11,reserved:9,remaining:11});
  const held=Number(sql(`SELECT quantity_held FROM pos_offline_allocation_resources WHERE allocation_id='${firstAllocation.id}';`));
  assert.equal(held,6);assert.equal(totals().orders,beforeFunding.orders);assert.equal(totals().tenders,beforeFunding.tenders);
  assert.equal(Number(sql(`SELECT available_quantity FROM get_pos_menu(${today}) WHERE id=${ids.phase103_main.menu};`)),11);
 });
 check("Stock reconciliation recognizes funded offline reservations",()=>{
  const h=health(),section=h.sections.find(s=>s.key==="daily_stock_drift");
  evidence.reconciliationAfterFunding=h;
  assert.equal(section.count,0,"funded allocation is reported as critical daily_stock_drift: "+JSON.stringify(section.items));
 });
 check("Daily stock display accounts for every reserved physical unit",()=>{
  const actual=stock("phase103_main");
  const displayed=JSON.parse(sql(`SELECT row_to_json(s) FROM get_daily_menu_stock(${today}) s WHERE portion_type_id=${ids.phase103_main.portion};`));
  evidence.dailyStockDisplay={actual,displayed};
  assert.equal(displayed.reserved_quantity,3);assert.equal(displayed.offline_allocation_held_quantity,6);
  assert.equal(displayed.stock_reserved_quantity,9);
  assert.equal(displayed.stock_starting_quantity-displayed.stock_reserved_quantity-displayed.stock_sold_quantity-displayed.stock_waste_quantity,displayed.stock_remaining_quantity);
  assert.equal(displayed.starting_quantity-displayed.reserved_quantity-displayed.sold_quantity-displayed.waste_quantity-displayed.offline_allocation_held_quantity,displayed.remaining_quantity,
    "allocation-held units are absent from the displayed reservation breakdown");
 });
 check("Normal online POS cannot consume allocation-held stock and rejection rolls back",()=>{
  const before=totals(),inventory=stock("phase103_main");
  assert.throws(()=>sql(online("phase103_main",12)),/Insufficient.*stock/i);
  assert.deepEqual(totals(),before);assert.deepEqual(stock("phase103_main"),inventory);
  const receipt=JSON.parse(sql(online("phase103_main",1)));assert.equal(receipt.totalAmount,2000);
  assert.equal(stock("phase103_main").finished,10);
  assert.equal(Number(sql("SELECT count(*) FROM online_receipt_print_jobs;")),0);
 });
 check("Funding does not create a tender or inflate daily cash reports",()=>{
  const cash=JSON.parse(sql(`SELECT row_to_json(r) FROM get_daily_cash_reconciliation(${today},0) r;`));
  assert.equal(Number(cash.cash_sales_ugx),8000);
  const close=JSON.parse(sql(`SELECT row_to_json(r) FROM get_daily_close_summary(${today}) r;`));
  assert.equal(Number(close.expected_pos_cash),8000);return {cash:cash.cash_sales_ugx,close:close.expected_pos_cash};
 });
 check("Allocation snapshot prices remain unchanged after menu price edits",()=>{
  sql(`UPDATE menu_items SET base_price=9999 WHERE id=${ids.phase103_main.menu};`);
  const snapshot=JSON.parse(sql(`SELECT get_pos_offline_snapshot('${terminals[0].id}','${terminals[0].epoch}','${key}','${cashier}');`));
  assert.equal(snapshot.items[0].unitPrice,2000);
  assert.throws(()=>sql(`SELECT get_pos_offline_snapshot('${terminals[0].id}','${terminals[0].epoch}','${"z".repeat(43)}','${cashier}');`),/funded_allocation_required/);
 });
 check("Banned cashier cannot receive offline grant snapshot",()=>{
  sql(`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${cashier}';`);
  assert.throws(()=>sql(`SELECT get_pos_offline_snapshot('${terminals[0].id}','${terminals[0].epoch}','${key}','${cashier}');`),/cashier_not_authorized/);
  sql(`UPDATE auth.users SET banned_until=null WHERE id='${cashier}';`);
 });
 check("Real row-level security and ACLs deny browser roles offline RPCs/tables",()=>{
  for(const role of ["anon","authenticated"]){
   const checks=JSON.parse(sql(`SELECT json_build_object('rpc',has_function_privilege('${role}','public.fund_pos_offline_allocation(uuid,uuid,uuid,uuid,bigint[],jsonb,timestamptz,uuid)','EXECUTE'),'table',has_table_privilege('${role}','public.pos_offline_allocations','SELECT'));`));
   assert.equal(checks.rpc,false);assert.equal(checks.table,false);
   assert.throws(()=>sql(`SET ROLE ${role}; SELECT * FROM pos_offline_allocations;`),/permission denied/);
  }
  assert.equal(sql("SELECT has_function_privilege('service_role','public.get_pos_offline_snapshot(uuid,uuid,text,uuid)','EXECUTE');"),"t");
  assert.equal(sql("SELECT has_table_privilege('service_role','public.pos_offline_allocations','INSERT');"),"f");
 });
 check("Undersized/expired funding and second terminal epoch are rejected without mutation",()=>{
  const before=totals();
  const tooSmall=funding(terminals[1],["phase103_second"],[{resourceId:ids.phase103_second.portion,quantity:6}]);
  assert.throws(()=>sql(tooSmall.statement),/allocation_minimum_35_percent/);
  const expired=funding(terminals[1],["phase103_second"]);
  assert.throws(()=>sql(expired.statement.replace(expiry,"now()-interval '1 second'")),/invalid_allocation_expiry/);
  assert.throws(()=>sql(`SELECT register_pos_offline_terminal('${terminals[0].id}','${randomUUID()}','${key}','${manager}');`),/reconcile_terminal_before_replacement/);
  assert.deepEqual(totals(),before);
 });
 check("Injected failure after first physical hold rolls back all rows and stock",()=>{
  const allocation=funding(terminals[2],["phase103_second","phase103_other"]);
  const before=totals(),second=stock("phase103_second"),other=stock("phase103_other");
  const failPortion=Math.max(ids.phase103_second.portion,ids.phase103_other.portion);
  sql(`CREATE FUNCTION public.phase103_test_fail_hold() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN
   IF new.portion_type_id=${failPortion} AND new.note LIKE '%${allocation.id}%' THEN RAISE EXCEPTION 'phase103_injected_mid_hold_failure'; END IF; RETURN new; END; $body$;
   CREATE TRIGGER phase103_test_fail_hold BEFORE INSERT ON finished_stock_movements FOR EACH ROW EXECUTE FUNCTION phase103_test_fail_hold();`);
  try{
   assert.throws(()=>sql(allocation.statement),/phase103_injected_mid_hold_failure/);
   assert.deepEqual(totals(),before);assert.deepEqual(stock("phase103_second"),second);assert.deepEqual(stock("phase103_other"),other);
  }finally{sql("DROP TRIGGER phase103_test_fail_hold ON finished_stock_movements; DROP FUNCTION phase103_test_fail_hold();");}
 });
 check("Default funding reserves seven of twenty units with full-schema constraints",()=>{
  const allocation=funding(terminals[1],["phase103_second"]);sql(allocation.statement);
  assert.deepEqual(stock("phase103_second"),{finished:13,reserved:7,remaining:13});
 });
 async function concurrent(input){return new Promise(resolve=>{
  const child=spawn(path.join(bin,"psql.exe"),["-X","-w","-q","-A","-t","-v","ON_ERROR_STOP=1"],{env,windowsHide:true,stdio:["pipe","pipe","pipe"]});
  let error="";child.stderr.on("data",b=>error+=b);child.on("error",e=>resolve({code:1,error:e.message}));
  child.on("exit",code=>resolve({code,error}));child.stdin.end(input);
 });}
 const racingAllocation=funding(terminals[3],["phase103_race"],[{resourceId:ids.phase103_race.portion,quantity:14}]);
 const race=await Promise.all([concurrent(racingAllocation.statement),concurrent(online("phase103_race",14))]);
 check("Concurrent allocation versus online Admin sale cannot oversell shared stock",()=>{
  assert.equal(race.filter(r=>r.code===0).length,1);
  assert.match(race.find(r=>r.code!==0).error,/insufficient.*stock/i);
  assert.equal(stock("phase103_race").finished,6);
  return race.map(r=>({succeeded:r.code===0,reason:r.code===0?null:/insufficient.*stock/i.exec(r.error)?.[0]}));
 });

 check("Shared-source portions reserve source units rather than invented child stock",()=>{
  sql(`INSERT INTO portion_types(code,name,stock_source_portion_type_id,stock_source_units_per_serving)
   VALUES('phase103_double','Synthetic two-unit serving',${ids.phase103_main.portion},2);
   INSERT INTO menu_items(code,menu_category_id,portion_type_id,name,base_price,prep_type)
   SELECT 'phase103_double',(SELECT id FROM menu_categories WHERE code='phase103_test'),id,'Synthetic two-unit serving',4000,'packed'
   FROM portion_types WHERE code='phase103_double';`);
  ids.phase103_double=JSON.parse(sql("SELECT json_build_object('portion',p.id,'menu',m.id) FROM portion_types p JOIN menu_items m ON m.portion_type_id=p.id WHERE p.code='phase103_double';"));
  const available=stock("phase103_main").finished,expected=Math.ceil(available*0.35);
  const allocation=funding(terminals[4],["phase103_double"]);sql(allocation.statement);
  const snapshot=JSON.parse(sql(`SELECT get_pos_offline_snapshot('${terminals[4].id}','${terminals[4].epoch}','${key}','${cashier}');`));
  assert.deepEqual(snapshot.items[0].requirements,[{resourceId:ids.phase103_main.portion,quantity:2}]);
  assert.equal(snapshot.budgets[0].quantity,expected);assert.equal(stock("phase103_main").finished,available-expected);
 });
 check("Composite menu snapshot freezes all stock requirements and holds every resource",()=>{
  sql(`INSERT INTO portion_types(code,name) VALUES('phase103_combo','Synthetic combo');
   INSERT INTO menu_items(code,menu_category_id,portion_type_id,name,base_price,prep_type)
   SELECT 'phase103_combo',(SELECT id FROM menu_categories WHERE code='phase103_test'),id,'Synthetic combo',6000,'packed'
   FROM portion_types WHERE code='phase103_combo';
   INSERT INTO menu_item_stock_requirements(menu_item_id,portion_type_id,units_per_menu_item)
   SELECT id,${ids.phase103_second.portion},2 FROM menu_items WHERE code='phase103_combo';
   INSERT INTO menu_item_stock_requirements(menu_item_id,portion_type_id,units_per_menu_item)
   SELECT id,${ids.phase103_other.portion},1 FROM menu_items WHERE code='phase103_combo';`);
  ids.phase103_combo=JSON.parse(sql("SELECT json_build_object('portion',p.id,'menu',m.id) FROM portion_types p JOIN menu_items m ON m.portion_type_id=p.id WHERE p.code='phase103_combo';"));
  const second=stock("phase103_second").finished,other=stock("phase103_other").finished;
  const allocation=funding(terminals[5],["phase103_combo"]);sql(allocation.statement);
  const snapshot=JSON.parse(sql(`SELECT get_pos_offline_snapshot('${terminals[5].id}','${terminals[5].epoch}','${key}','${cashier}');`));
  assert.deepEqual(snapshot.items[0].requirements,[
   {resourceId:ids.phase103_second.portion,quantity:2},{resourceId:ids.phase103_other.portion,quantity:1}
  ].sort((a,b)=>a.resourceId-b.resourceId));
  assert.equal(stock("phase103_second").finished,second-Math.ceil(second*.35));
  assert.equal(stock("phase103_other").finished,other-Math.ceil(other*.35));
 });
 check("Unused migration creates no changes to immutable day-close snapshots",()=>{
  assert.equal(Number(sql("SELECT count(*) FROM daily_close_snapshots;")),0);
  assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname='daily_close_snapshots_prevent_update_delete' AND NOT tgisinternal;"),"1");
 });

 check("Zero allocation reporting preserves all legacy values",()=>{
  const row=JSON.parse(sql("SELECT row_to_json(s) FROM get_daily_menu_stock("+today+") s WHERE portion_type_id="+ids.phase103_empty.portion+";"));
  assert.equal(row.offline_allocation_held_quantity,0);assert.equal(row.reserved_quantity,0);assert.equal(row.remaining_quantity,0);
 });
 check("Multiple allocations aggregate source units without changing per-serving fields",()=>{
  const expected=Number(sql("SELECT sum(quantity_held) FROM pos_offline_allocation_resources WHERE portion_type_id="+ids.phase103_main.portion+";"));
  assert.equal(expected,10);
  for(const code of ["phase103_main","phase103_double"]){
   const row=JSON.parse(sql("SELECT row_to_json(s) FROM get_daily_menu_stock("+today+") s WHERE portion_type_id="+ids[code].portion+";"));
   assert.equal(row.offline_allocation_held_quantity,expected);
   assert.equal(row.stock_starting_quantity-row.stock_reserved_quantity-row.stock_sold_quantity-row.stock_waste_quantity,row.stock_remaining_quantity);
   assert.equal(row.allocation_stock_portion_type_id,ids.phase103_main.portion);
  }
  assert.equal(health().critical_count,0);
 });
 check("Critical stock drift detection remains active",()=>{
  try{
   sql("UPDATE daily_stock SET reserved_quantity=reserved_quantity-1 WHERE stock_date="+today+" AND portion_type_id="+ids.phase103_main.portion+";");
   const drift=health().sections.find(x=>x.key==="daily_stock_drift");
   assert.equal(drift.count,1);assert.equal(drift.items[0].offline_allocation_held_quantity,10);
   assert.equal(drift.items[0].expected_paid_reserved_quantity,4);assert.equal(drift.items[0].expected_reserved_quantity,14);
  }finally{sql("UPDATE daily_stock SET reserved_quantity=reserved_quantity+1 WHERE stock_date="+today+" AND portion_type_id="+ids.phase103_main.portion+";");}
  assert.equal(health().critical_count,0);
 });
 check("Expiry or reconciled state alone never clears unproven allocation holds",()=>{
  const expected=Number(sql("SELECT held_quantity FROM get_pos_offline_allocation_holds("+today+") WHERE portion_type_id="+ids.phase103_main.portion+";"));
  const held=Number(sql("BEGIN; UPDATE pos_offline_allocations SET expires_at=now()-interval '1 hour',state='reconciled' WHERE id='"+firstAllocation.id+"'; SELECT held_quantity FROM get_pos_offline_allocation_holds("+today+") WHERE portion_type_id="+ids.phase103_main.portion+"; ROLLBACK;"));
  assert.equal(held,expected);
 });
 check("Cross-day allocation reporting is attributed to funding service day",()=>{
  const result=JSON.parse(sql("BEGIN; UPDATE pos_offline_allocations SET service_date=service_date-1 WHERE id='"+firstAllocation.id+"'; SELECT json_build_object('today',(SELECT held_quantity FROM get_pos_offline_allocation_holds("+today+") WHERE portion_type_id="+ids.phase103_main.portion+"),'prior',(SELECT held_quantity FROM get_pos_offline_allocation_holds("+today+"-1) WHERE portion_type_id="+ids.phase103_main.portion+")); ROLLBACK;"));
  assert.deepEqual(result,{today:4,prior:6});
 });
 check("Larger funding requires manager authority and does not mutate stock on rejection",()=>{
  const before=totals();const allocation=funding(terminals[6],["phase103_other"],[{resourceId:ids.phase103_other.portion,quantity:10}]);
  assert.throws(()=>sql(allocation.statement.replace(manager,cashier)),/manager_required/);assert.deepEqual(totals(),before);
 });
 const beforeRace=stock("phase103_other").finished;
 const fundingRace=await Promise.all([6,7].map(i=>concurrent(funding(terminals[i],["phase103_other"],[{resourceId:ids.phase103_other.portion,quantity:beforeRace}]).statement)));
 check("Concurrent terminal funding cannot fund the same stock twice",()=>{
  assert.equal(fundingRace.filter(x=>x.code===0).length,1);
  assert.match(fundingRace.find(x=>x.code!==0).error,/insufficient.*stock/i);
  assert.equal(stock("phase103_other").finished,0);assert.equal(health().critical_count,0);
 });
 const numbering=await Promise.all(Array.from({length:8},()=>concurrent("INSERT INTO portion_types(code,name) SELECT 'number_race_'||generate_order_number(),'Synthetic numbering';")));
 check("Concurrent sequence-backed order number generation remains unique",()=>{
  assert.ok(numbering.every(x=>x.code===0));assert.equal(Number(sql("SELECT count(*) FROM portion_types WHERE code LIKE 'number_race_%';")),8);
 });
 check("Appended reporting fields preserve every original daily-stock value",()=>{
  const keys=["allocation_stock_portion_type_id","offline_allocation_held_quantity","stock_starting_quantity","stock_reserved_quantity","stock_sold_quantity","stock_waste_quantity","stock_remaining_quantity"];
  assert.equal(sql("SELECT bool_and(to_jsonb(n)-ARRAY["+keys.map(k=>"'"+k+"'").join(",")+"]::text[]=to_jsonb(b)) FROM get_daily_menu_stock("+today+") n JOIN get_daily_menu_stock_phase103_base("+today+") b USING(portion_type_id);"),"t");
 });
 check("New reporting RPCs preserve service-only access",()=>{
  for(const name of ["get_daily_menu_stock","get_daily_menu_stock_phase103_base","get_pos_offline_allocation_holds"]){
   for(const role of ["anon","authenticated"])assert.equal(sql("SELECT has_function_privilege('"+role+"','public."+name+"(date)','EXECUTE');"),"f");
   assert.equal(sql("SELECT has_function_privilege('service_role','public."+name+"(date)','EXECUTE');"),"t");
   sql("SET ROLE service_role; SELECT count(*) FROM "+name+"("+today+");");
  }
 });
 check("Closed-day snapshots remain immutable and are not recomputed",()=>{
  sql("INSERT INTO daily_close_snapshots(service_date,closed_by_profile_id,closed_by_email_snapshot,closed_by_role_snapshot,opening_float_ugx,cash_counted_ugx,expected_pos_cash_ugx,cash_difference_ugx,snapshot) VALUES("+today+"-1,'"+manager+"','manager@phase103.invalid','manager',0,0,0,0,'{\"historical\":true}');");
  assert.throws(()=>sql("UPDATE daily_close_snapshots SET snapshot='{}' WHERE service_date="+today+"-1;"),/daily_close_snapshot_is_immutable/);
  assert.throws(()=>sql("DELETE FROM daily_close_snapshots WHERE service_date="+today+"-1;"),/daily_close_snapshot_is_immutable/);
  sql("SELECT * FROM get_daily_menu_stock("+today+"-1); SELECT * FROM get_business_truth_health_snapshot(now(),"+today+"-1);");
  assert.equal(sql("SELECT snapshot::text FROM daily_close_snapshots WHERE service_date="+today+"-1;"),'{"historical": true}');
 });
 check("Real online POS orders cross the 999 boundary without renumbering history",()=>{
  const historical=sql("SELECT json_agg(order_number ORDER BY id) FROM orders;");
  const lastId=Number(sql("SELECT coalesce(max(id),0) FROM orders;"));
  sql("ALTER SEQUENCE public.order_number_seq RESTART WITH 998;");
  for(let i=0;i<4;i++)sql(online("phase103_second",1));
  assert.deepEqual(JSON.parse(sql("SELECT json_agg(order_number ORDER BY id) FROM orders WHERE id>"+lastId+";")),["998","999","1000","1001"]);
  assert.equal(sql("SELECT json_agg(order_number ORDER BY id) FROM orders WHERE id<="+lastId+";"),historical);
  assert.equal(sql("SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_order_number_key' AND contype='u';"),"1");
  assert.equal(health().critical_count,0);
 });

 await (await import("./test-offline-ingestion-full-schema.mjs")).testOfflineIngestion({sql,check,manager,cashier,today,expiry,health,concurrent});
 evidence.phase3BDependencies=["Manager resolution of quarantined evidence/closed-day adjustments, allocation return/handover and fleet management remain Phase 3C."];

 evidence.objects=JSON.parse(sql("SELECT json_build_object('functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),'tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'));"));
}catch(error){evidence.failure=error.message;console.error("FULL_SCHEMA_TEST_FAILURE:",error.message);process.exitCode=1;}
finally{
 fs.writeFileSync(path.join(snapshot,"full-schema-results.json"),JSON.stringify(evidence,null,2));
 if(started)run("pg_ctl",["-D",data,"-m","immediate","-w","stop"]);
 const resolved=path.resolve(root),prefix=path.resolve(os.tmpdir())+path.sep+"smokehouse-full-schema-test-";
 if(!resolved.startsWith(prefix))throw Error("Unsafe fixture cleanup path");
 fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:300});
 console.log("RESULTS="+path.join(snapshot,"full-schema-results.json"));
}
