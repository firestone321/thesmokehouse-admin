// Isolated synthetic PostgreSQL cluster. Never loads .env or connects to Supabase.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawnSync,spawn } from "node:child_process";
import assert from "node:assert/strict";
const bin=process.env.POSTGRES_TEST_BIN||"C:/Program Files/PostgreSQL/18/bin";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"smokehouse-offline-pg-test-"));
const data=path.join(root,"data"),log=path.join(root,"postgres.log");
const probe=net.createServer();await new Promise(r=>probe.listen(0,"127.0.0.1",r));
const port=probe.address().port;await new Promise(r=>probe.close(r));
const pgEnv={...process.env,PGHOST:"127.0.0.1",PGHOSTADDR:"127.0.0.1",PGPORT:String(port),PGUSER:"offline_fixture",PGDATABASE:"postgres",PGPASSWORD:"",PGCONNECT_TIMEOUT:"5"};
delete pgEnv.PGSERVICE;delete pgEnv.PGOPTIONS;
function run(name,args,input){const r=spawnSync(path.join(bin,name+".exe"),args,{env:pgEnv,input,encoding:"utf8",windowsHide:true,...(name==="pg_ctl"?{stdio:"ignore"}:{}),timeout:180000});if(r.error||r.status!==0)throw Error(name+": "+(r.stdout||"")+" "+(r.stderr||r.error));return r.stdout||"";}
function sql(input){return run("psql",["-X","-w","-q","-A","-t","-v","ON_ERROR_STOP=1"],input);}
const manager="00000000-0000-4000-8000-000000000001",cashier="00000000-0000-4000-8000-000000000002";
const terminal1="00000000-0000-4000-8000-000000000011",terminal2="00000000-0000-4000-8000-000000000012",epoch="00000000-0000-4000-8000-000000000021";
const allocation1="00000000-0000-4000-8000-000000000031",allocation2="00000000-0000-4000-8000-000000000032",catalog1="00000000-0000-4000-8000-000000000041",catalog2="00000000-0000-4000-8000-000000000042";
let started=false;
try {
 run("initdb",["-D",data,"-A","trust","-U","offline_fixture","--encoding=UTF8","--no-locale","--no-sync","--no-instructions"]);
 started=true;run("pg_ctl",["-D",data,"-l",log,"-o","-h 127.0.0.1 -p "+port,"-w","-t","30","start"]);
 sql(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL);
 CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz);
 CREATE TABLE public.portion_types(id bigint PRIMARY KEY,stock_source_portion_type_id bigint,stock_source_units_per_serving integer);
 CREATE TABLE public.menu_items(id bigint PRIMARY KEY,name text,base_price integer,is_active boolean,is_available_today boolean,portion_type_id bigint,code text);
 CREATE TABLE public.menu_item_stock_requirements(menu_item_id bigint,portion_type_id bigint,units_per_menu_item integer);
 CREATE TABLE public.finished_stock(portion_type_id bigint PRIMARY KEY,current_quantity integer NOT NULL CHECK(current_quantity>=0));
 CREATE TABLE public.daily_stock(stock_date date,portion_type_id bigint,starting_quantity integer NOT NULL,
 reserved_quantity integer NOT NULL DEFAULT 0,sold_quantity integer NOT NULL DEFAULT 0,waste_quantity integer NOT NULL DEFAULT 0,
 remaining_quantity integer GENERATED ALWAYS AS(starting_quantity-reserved_quantity-sold_quantity-waste_quantity) STORED,
 PRIMARY KEY(stock_date,portion_type_id),CHECK(starting_quantity>=reserved_quantity+sold_quantity+waste_quantity));
 CREATE TABLE public.finished_stock_movements(portion_type_id bigint,movement_type text,quantity_delta integer,resulting_quantity integer,note text);
 INSERT INTO profiles VALUES('${manager}','manager'),('${cashier}','cashier');
 INSERT INTO auth.users VALUES('${manager}',null),('${cashier}',null);
 INSERT INTO portion_types VALUES(1,null,1),(2,null,1);
 INSERT INTO menu_items VALUES(1,'Fixture water',2000,true,true,1,'water');
 INSERT INTO finished_stock VALUES(1,4),(2,0);
 `);
 sql(fs.readFileSync("db/phase-103-offline-pos-foundations.sql","utf8"));
 sql(`SELECT register_pos_offline_terminal('${terminal1}','${epoch}','${"x".repeat(43)}','${manager}');
 SELECT register_pos_offline_terminal('${terminal2}','${epoch}','${"y".repeat(43)}','${manager}');`);
 const expiry="least(now()+interval '30 minutes',date_trunc('day',now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala'+interval '23 hours 59 minutes')";
 function fund(id,terminal,catalog,budgets,actor=manager){return `SELECT fund_pos_offline_allocation('${id}','${terminal}','${epoch}','${catalog}',ARRAY[1]::bigint[],'${JSON.stringify(budgets)}'::jsonb,${expiry},'${actor}');`;}
 assert.throws(()=>sql(fund(allocation1,terminal1,catalog1,[{resourceId:1,quantity:2},{resourceId:2,quantity:1}])),/insufficient_finished_stock/);
 assert.equal(sql("SELECT current_quantity FROM finished_stock WHERE portion_type_id=1;").trim(),"4");
 assert.equal(sql("SELECT count(*) FROM pos_offline_allocations;").trim(),"0");
 assert.throws(()=>sql(fund(allocation1,terminal1,catalog1,[{resourceId:1,quantity:3}],cashier)),/manager_required/);
 assert.throws(()=>sql(fund(allocation1,terminal1,catalog1,[{resourceId:1,quantity:1}])),/allocation_minimum_35_percent/);
 async function concurrent(input){return new Promise(resolve=>{const child=spawn(path.join(bin,"psql.exe"),["-X","-w","-q","-A","-t","-v","ON_ERROR_STOP=1"],{env:pgEnv,windowsHide:true,stdio:["pipe","pipe","pipe"]});let error="";child.stderr.on("data",b=>error+=b);child.on("exit",code=>resolve({code,error}));child.stdin.end(input);});}
 const outcomes=await Promise.all([
 concurrent(fund(allocation1,terminal1,catalog1,[{resourceId:1,quantity:3}])),
 concurrent(fund(allocation2,terminal2,catalog2,[{resourceId:1,quantity:3}]))
 ]);
 assert.equal(outcomes.filter(x=>x.code===0).length,1);
 assert.match(outcomes.find(x=>x.code!==0).error,/insufficient_finished_stock/);
 assert.equal(sql("SELECT current_quantity FROM finished_stock WHERE portion_type_id=1;").trim(),"1");
 assert.equal(sql("SELECT reserved_quantity FROM daily_stock WHERE portion_type_id=1;").trim(),"3");
 const funded=sql("SELECT terminal_id FROM pos_offline_allocations;").trim(),key=funded===terminal1?"x".repeat(43):"y".repeat(43);
 const snapshot=JSON.parse(sql(`SELECT get_pos_offline_snapshot('${funded}','${epoch}','${key}','${cashier}');`).trim());
 assert.equal(snapshot.items[0].unitPrice,2000);
 sql("UPDATE menu_items SET base_price=9999;");
 const frozen=JSON.parse(sql(`SELECT get_pos_offline_snapshot('${funded}','${epoch}','${key}','${cashier}');`).trim());
 assert.equal(frozen.items[0].unitPrice,2000);
 assert.throws(()=>sql(`SELECT get_pos_offline_snapshot('${funded}','${epoch}','${"z".repeat(43)}','${cashier}');`),/funded_allocation_required/);
 sql(`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${cashier}';`);
 assert.throws(()=>sql(`SELECT get_pos_offline_snapshot('${funded}','${epoch}','${key}','${cashier}');`),/cashier_not_authorized/);
 assert.equal(sql("SELECT has_function_privilege('authenticated','public.get_pos_offline_snapshot(uuid,uuid,text,uuid)','EXECUTE');").trim(),"f");
 const third="00000000-0000-4000-8000-000000000013",thirdAllocation="00000000-0000-4000-8000-000000000033",thirdCatalog="00000000-0000-4000-8000-000000000043";
 sql(`SELECT register_pos_offline_terminal('${third}','${epoch}','${"z".repeat(43)}','${manager}');
 UPDATE finished_stock SET current_quantity=20 WHERE portion_type_id=2;
 INSERT INTO menu_items VALUES(2,'Second fixture',1000,true,true,2,'fixture_two');
 SELECT fund_pos_offline_allocation('${thirdAllocation}','${third}','${epoch}','${thirdCatalog}',ARRAY[2]::bigint[],null,${expiry},'${manager}');`);
 assert.equal(sql("SELECT current_quantity FROM finished_stock WHERE portion_type_id=2;").trim(),"13");
 assert.equal(sql("SELECT reserved_quantity FROM daily_stock WHERE portion_type_id=2;").trim(),"7");
 console.log("PASS: isolated migration compiles; atomic hold rollback; concurrent allocation exhaustion; role/key/ban checks; frozen prices; restricted grants.");
} catch(error) {console.error("SQL_FIXTURE_FAILURE:",error.message);throw error;} finally {
 if(started)run("pg_ctl",["-D",data,"-m","immediate","-w","stop"]);
 const resolved=path.resolve(root),prefix=path.resolve(os.tmpdir())+path.sep+"smokehouse-offline-pg-test-";
 if(!resolved.startsWith(prefix))throw Error("Unsafe fixture cleanup path");
 try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:300});}catch(error){console.warn("Fixture cleanup pending:",resolved,error.code);}
}
