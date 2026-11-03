import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const admin=path.resolve(process.cwd(),'../thesmokehouse-admin');
process.chdir(admin);
const require=createRequire(path.join(admin,'package.json'));
const {loadTs}=await import(pathToFileURL(path.join(admin,'tests/pos-test-loader.mjs')));
const flags=['POS_OFFLINE_ENABLED','POS_OFFLINE_SYNC_ENABLED','POS_OFFLINE_OPERATIONS_ENABLED','POS_OFFLINE_REPLENISHMENT_ENABLED','OFFLINE_ORDERS_ENABLED'];
process.env.NODE_ENV='production';for(const f of flags)process.env[f]='false';
class AuthError extends Error {constructor(status){super('Authorization rejected');this.status=status;}}
const json={NextResponse:{json:(value,init)=>Response.json(value,init)}};
const grant=loadTs('lib/pos/offline-grant.ts',{'server-only':{}});
test('production offline entry flag is false when absent or explicitly false',()=>{
 delete process.env.POS_OFFLINE_ENABLED;assert.equal(grant.offlinePosEnabled(),false);
 process.env.POS_OFFLINE_ENABLED='false';assert.equal(grant.offlinePosEnabled(),false);
});
test('production cannot issue offline grants when disabled',async()=>{await assert.rejects(grant.signOfflineGrant({},'cashier'),/disabled/)});
test('normal POS assembly omits local bridge and offline station with flags disabled',async()=>{
 const {default:page}=loadTs('app/(admin)/pos/page.tsx',{
  '@/components/pos/terminal-handover':{TerminalHandover:()=>null},
  '@/components/pos/offline-station':{OfflineStation:()=>null},
  '@/lib/pos/offline-grant':grant,
  '@/lib/auth/admin-role':{requirePosAccess:async()=>({userId:'cashier',role:'cashier',email:null})},
  '@/lib/ops/queries':{getOnlineReceiptPrintBacklogSnapshot:async()=>({pendingCount:0,jobs:[]})},
  '@/lib/pos/queries':{getPosMenuItems:async()=>[{id:1}]},
  '@/components/pos/pos-sale-workspace':{PosSaleWorkspace:'workspace'}
 });
 const element=await page(),children=element.props.children;
 assert.equal(children[0],null);assert.equal(children[2].props.bridgeUrl,undefined);assert.equal(children[2].props.canRecordSales,true);
});
test('disabled handover does not query absent Phase 3 tables or RPCs',async()=>{
 let calls=0;const {TerminalHandover}=loadTs('components/pos/terminal-handover.tsx',{
  'next/link':()=>null,'@/lib/supabase/server':{createAdminSupabaseClient(){calls++;throw Error('No Phase 3 DB objects')}},
  './offline-identity-lookup':{OfflineIdentityLookup:()=>null}
 });assert.equal(await TerminalHandover({actorId:'cashier',manager:false}),null);assert.equal(calls,0);
});
const schema=loadTs('lib/schemas/admin.ts',{'@/lib/ops/types':loadTs('lib/ops/types.ts')}).posSaleRequestSchema;
const {hashableSale}=loadTs('lib/pos/sale-contract.ts');
const receipt={orderId:1,orderNumber:'182',status:'confirmed',totalAmount:2000,amountReceived:2000,changeGiven:0,
 canonicalReceipt:{saleId:'182',date:new Date().toISOString(),items:[{name:'Synthetic',quantity:1,unitPrice:2000,total:2000}],subtotal:2000,total:2000,paymentMethod:'cash'}};
const body={idempotencyKey:'00000000-0000-4000-8000-000000000001',amountReceived:2000,items:[{menuItemId:1,quantity:1}]};
function api(tenderType,deny=0){
 const calls=[],hardware=[];
 const {decorateReceipt}=loadTs('lib/pos/sale-server.ts',{'server-only':{},'@/lib/supabase/server':{},'@/lib/pos/hardware-bridge':{isPosHardwareBridgeEnabled:()=>true}});
 const route=loadTs('app/api/admin/pos/sales/route.ts',{
  'next/server':json,
  '@/lib/auth/admin-role':{AdminAuthorizationError:AuthError,assertSameOriginRequest(){},requirePosAccess:async()=>{if(deny)throw new AuthError(deny);return {userId:'cashier'}}},
  '@/lib/schemas/admin':{posSaleRequestSchema:schema},
  '@/lib/supabase/server':{createAdminSupabaseClient:()=>({rpc:async(name,args)=>{calls.push({name,args});assert.equal(name,'create_pos_sale_with_receipt','Unexpected non-Phase-2 RPC');return {data:{...receipt,tenderType},error:null}},from(){throw Error('Unexpected Phase 3 table access')}})},
  '@/lib/validation/http':{RequestValidationError:class extends Error{},parseJsonBody:async(req,s)=>s.parse(await req.json())},
  '@/lib/request-limits':{RequestBodyTooLargeError:class extends Error{}},
  '@/lib/pos/sale-contract':{hashableSale},'@/lib/pos/sale-server':{decorateReceipt},
  '@/lib/pos/hardware-bridge':{issueWalkInHardwareAction:async(...args)=>{hardware.push(args);return null}},
  '@/lib/pos/timing':{posTimer:()=>()=>{}}
 });
 return {calls,hardware,call:()=>route.POST(new Request('https://admin.test/api/admin/pos/sales',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,tenderType,...(tenderType==='cash'?{}:{paymentReference:'1234'})})}))};
}
for(const tender of ['cash','card','mobile_money'])test('production '+tender+' uses only Phase 2 sale RPC with offline disabled',async()=>{
 const h=api(tender),r=await h.call();assert.equal(r.status,200);const result=await r.json();assert.equal(result.data.totalAmount,2000);assert.equal(result.data.hardwareEnabled,tender==='cash');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_idempotency_key,body.idempotencyKey);assert.equal(h.calls[0].args.p_cashier_profile_id,'cashier');assert.equal(h.hardware.length,tender==='cash'?2:0);
});
for(const status of [401,403])test('production online authorization '+status+' prevents sale RPC execution',async()=>{const h=api('cash',status),r=await h.call();assert.equal(r.status,status);assert.equal(h.calls.length,0);assert.equal(h.hardware.length,0)});
