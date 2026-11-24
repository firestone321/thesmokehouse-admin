// Synthetic static rendering of the real workspace; no production, payments or hardware.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTs} from './pos-test-loader.mjs';

test('synthetic workspace layout at POS, laptop and desktop viewports', {timeout:90000}, async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'smokehouse-pos-viewport-'));
  const attempt={state:'outcome_unknown',updatedAt:1700000000000,payload:{idempotencyKey:'00000000-0000-4000-8000-000000000001',tenderType:'cash',amountReceived:2000,items:[{menuItemId:42,quantity:1}]}};
  const sale={attempt,ready:true,busy:false,message:null,history:[],checkOutcome(){},retryOriginal(){},startNew(){}};
  const react={useState:v=>[v,()=>{}],useMemo:fn=>fn(),useCallback:fn=>fn,useEffect:()=>{}};
  const m=loadTs('components/pos/pos-sale-workspace.tsx',{
    react,'@/lib/pos/use-pos-sale':{usePosSale:()=>sale},
    '@/components/pos/recorded-sales':{RecordedSales:()=>null},
    '@/components/orders/online-receipt-print-backlog-card':{OnlineReceiptPrintBacklogCard:()=>null},
    '@/components/pwa/pos-print-station-toggle':{PosPrintStationToggle:()=>null},
    '@/components/ugx-amount-input':{UgxAmountInput:()=>null}
  });
  const tree=m.PosSaleWorkspace({cashierId:'cashier',cashierEmail:'cashier@example.invalid',menuItems:[{id:42,name:'Goat ribs',categoryName:'Goat',availableQuantity:10,basePrice:2000,imageUrl:null}],onlineReceiptPrintBacklog:{},canRecordSales:true});
  const content=renderToStaticMarkup(tree);
  const cssdir=path.resolve('.next/static/css');
  const styles=(await Promise.all((await readdir(cssdir)).filter(n=>n.endsWith('.css')).map(n=>readFile(path.join(cssdir,n),'utf8')))).join('\n');
  assert.ok(styles.includes('min-height:44px'),'production CSS contains touch target rule');
  const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head><body><main style="padding:20px">${content}</main></body></html>`;
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let child,socket,seq=0;const pending=new Map(),listeners=new Set();
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  try {
    child=spawn(process.env.POS_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chrome startup timed out')),20000);child.once('error',reject);child.stderr.on('data',chunk=>{output+=chunk;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
    socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const cb=pending.get(msg.id);pending.delete(msg.id);if(msg.error)cb?.reject(Error(msg.error.message));else cb?.resolve(msg.result);}else for(const fn of listeners)fn(msg);});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});await send('Page.enable',{},sessionId);
    const loaded=new Promise(resolve=>{const fn=m=>{if(m.method==='Page.loadEventFired'&&m.sessionId===sessionId){listeners.delete(fn);resolve();}};listeners.add(fn);});
    await send('Page.navigate',{url:origin},sessionId);await loaded;
    for(const [width,height] of [[1024,768],[1366,768],[1920,1080]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
      const result=await send('Runtime.evaluate',{returnByValue:true,expression:`(()=>{const buttons=[...document.querySelectorAll('button')];const check=buttons.find(b=>b.textContent==='1. Check Sale Status'),retry=buttons.find(b=>b.textContent==='2. Retry Same Sale');const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,scroll:e.scrollWidth,client:e.clientWidth}};return {width:innerWidth,scroll:document.documentElement.scrollWidth,check:rect(check),retry:rect(retry),cardColor:getComputedStyle(check.closest('section')).backgroundColor,reference:document.body.innerText.includes('00000000-0000-4000-8000-000000000001')};})()`},sessionId);
      const v=result.result.value;assert.equal(v.reference,true);assert.equal(v.cardColor,'rgb(255, 240, 207)');assert.ok(v.scroll<=v.width,`${width}: horizontal overflow`);
      for(const b of [v.check,v.retry]){assert.ok(b.left>=0&&b.right<=width&&b.top>=0&&b.bottom<=height,`${width}: button outside viewport ${JSON.stringify(b)}`);assert.ok(b.height>=44);assert.ok(b.scroll<=b.client,`${width}: clipped label`);}
      assert.ok(v.check.top<v.retry.top||v.check.left<v.retry.left,`${width}: incorrect visual order`);
      console.log(`PASS ${width}x${height}: labels visible, ordered, >=44px, no horizontal overflow`);
    }
  } finally {
    if(socket){await send('Browser.close').catch(()=>{});socket.close();}
    if(child && child.exitCode===null) await new Promise(resolve=>child.once('exit',resolve));
    await new Promise(resolve=>server.close(resolve));
    const safe=path.resolve(profile),base=path.resolve(os.tmpdir());
    if(path.dirname(safe)!==base||!path.basename(safe).startsWith('smokehouse-pos-viewport-'))throw Error('Unsafe cleanup target');
    await rm(safe,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
