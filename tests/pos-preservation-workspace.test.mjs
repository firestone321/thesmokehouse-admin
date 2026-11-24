import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './pos-test-loader.mjs';

const key='00000000-0000-4000-8000-000000000001';
const product={id:42,name:'Goat ribs',categoryName:'Goat',availableQuantity:10,basePrice:2000,imageUrl:null};
const pending={ownerId:'cashier',state:'outcome_unknown',updatedAt:1700000000000,payload:{idempotencyKey:key,tenderType:'cash',amountReceived:2000,items:[{menuItemId:42,quantity:1}]},hardware:{drawer:{state:'not_requested',requestId:'original'},receipt:{state:'not_requested',requestId:'original'}}};
function setup(attempt=null){
  const slots=[];let cursor=0;const calls=[],recovery=[];
  const react={useState:v=>{const i=cursor++;if(!(i in slots))slots[i]=v;return [slots[i],x=>slots[i]=typeof x==='function'?x(slots[i]):x];},useCallback:fn=>fn,useMemo:fn=>fn(),useEffect:()=>{}};
  const jsx=(type,props)=>({type,props:props||{}});
  const sale={attempt,ready:true,busy:false,message:null,history:[],submit:async v=>calls.push(v),checkOutcome:async()=>recovery.push('check'),retryOriginal:async()=>recovery.push('retry'),startNew:async()=>{},reprint:async()=>{},checkHardware:async()=>{}};
  const m=loadTs('components/pos/pos-sale-workspace.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
    '@/lib/pos/use-pos-sale':{usePosSale:()=>sale},
    '@/components/pos/recorded-sales':{RecordedSales:'RecordedSales'},
    '@/components/orders/online-receipt-print-backlog-card':{OnlineReceiptPrintBacklogCard:'Backlog'},
    '@/components/pwa/pos-print-station-toggle':{PosPrintStationToggle:'PrintToggle'},
    '@/components/ugx-amount-input':{UgxAmountInput:'AmountInput'}
  });
  function render(){cursor=0;return m.PosSaleWorkspace({cashierId:'cashier',cashierEmail:'cashier@example.invalid',menuItems:[product],onlineReceiptPrintBacklog:{},canRecordSales:true});}
  function flatten(v){if(v==null||typeof v==='boolean')return [];if(Array.isArray(v))return v.flatMap(flatten);if(typeof v!=='object')return [String(v)];return [v,...flatten(v.props?.children)];}
  function button(tree,label){return flatten(tree).find(n=>typeof n==='object'&&n.type==='button'&&flatten(n.props.children).some(s=>typeof s==='string'&&s.includes(label)));}
  return {render,flatten,button,calls,recovery};
}
test('normal product selection adds to basket',()=>{const h=setup();let tree=h.render();h.button(tree,'Goat ribs').props.onClick();tree=h.render();assert.ok(h.flatten(tree).some(x=>x==='Goat ribs'));assert.ok(h.flatten(tree).some(x=>x==='1'));});
test('ambiguous sale is identifiable and separate basket remains payment blocked',()=>{const h=setup(pending);let tree=h.render();let text=h.flatten(tree).filter(x=>typeof x==='string').join(' ');assert.match(text,new RegExp(key));assert.match(text,/Not available yet/);assert.match(text,/Goat ribs/);assert.ok(h.button(tree,'2. Retry Same Sale'));h.button(tree,'Prepare a different basket').props.onClick();tree=h.render();h.button(tree,'Goat ribs').props.onClick();tree=h.render();assert.equal(h.button(tree,'Resolve previous sale before payment').props.disabled,true);assert.equal(h.calls.length,0);assert.deepEqual(pending.payload.items,[{menuItemId:42,quantity:1}]);});
test('recovery card and actions are colored, ordered and touch-sized',()=>{const h=setup({...pending,state:'prepared'});const tree=h.render(),nodes=h.flatten(tree),card=nodes.find(n=>typeof n==='object'&&n.type==='section'&&n.props.role==='alert'),check=h.button(tree,'1. Check Sale Status'),retry=h.button(tree,'2. Retry Same Sale');assert.match(card.props.className,/bg-\[#FFF0CF\]/);assert.ok(nodes.indexOf(check)<nodes.indexOf(retry));assert.match(check.props.className,/bg-\[#EDF7FF\]/);assert.match(retry.props.className,/bg-\[#166534\]/);assert.match(check.props.className,/min-h-\[44px\]/);assert.match(retry.props.className,/min-h-\[44px\]/);assert.equal(h.button(tree,'Close rejected sale'),undefined);});
test('both recovery controls invoke only their intended handler',()=>{const h=setup(pending),tree=h.render();h.button(tree,'1. Check Sale Status').props.onClick();h.button(tree,'2. Retry Same Sale').props.onClick();assert.deepEqual(h.recovery,['check','retry']);assert.equal(h.calls.length,0);});
test('category navigation and search continue to filter products',()=>{const h=setup();let tree=h.render();h.button(tree,'Goat').props.onClick();tree=h.render();const search=h.flatten(tree).find(n=>typeof n==='object'&&n.type==='input'&&n.props.placeholder==='Search item or category');search.props.onChange({target:{value:'not on menu'}});tree=h.render();assert.ok(h.flatten(tree).some(n=>typeof n==='string'&&n.includes('No sellable stock')));});
test('known rejection is explicitly closable',()=>{const h=setup({...pending,state:'rejected'});assert.ok(h.button(h.render(),'Close rejected sale'));});
test('confirmed attempt exposes order number and completion control',()=>{const h=setup({...pending,state:'committed',receipt:{orderNumber:'180'}});const tree=h.render();assert.match(h.flatten(tree).filter(x=>typeof x==='string').join(' '),/180/);assert.ok(h.button(tree,'Finish confirmed sale'));});
