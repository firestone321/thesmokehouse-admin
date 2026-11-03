import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {loadTs} from "./pos-test-loader.mjs";
const {offlinePosEnabled}=loadTs("lib/pos/offline-grant.ts",{"server-only":{}});
const {default:Shell}=loadTs("app/pos-shell/page.tsx",{
 "@/components/pos/offline-pos-entry":{OfflinePosEntry:"offline-entry"},
 "@/lib/pos/offline-grant":{offlinePosEnabled}
});
for(const value of [undefined,"false","true"])test("public shell deployment gate: "+String(value),()=>{
 const old=process.env.POS_OFFLINE_ENABLED;
 try{if(value===undefined)delete process.env.POS_OFFLINE_ENABLED;else process.env.POS_OFFLINE_ENABLED=value;
 const children=Shell().props.children;assert.equal(children[0].props.content,value==="true"?"enabled":"disabled");assert.equal(children[1].type,value==="true"?"offline-entry":"p");
 }finally{if(old===undefined)delete process.env.POS_OFFLINE_ENABLED;else process.env.POS_OFFLINE_ENABLED=old;}
});
async function worker(posHtml){
 const events={},stored=new Map(),assets=[],deleted=[],old="smokehouse-admin-v5";
 const cache={addAll:async xs=>assets.push(...xs),put:async(k,v)=>stored.set(k,v),delete:async k=>{deleted.push(k);return stored.delete(k)}};
 const context={Response,URL,console,fetch:async u=>new Response(u==="/pos-shell"?posHtml:"<html>Orders data-free test shell</html>"),
 caches:{open:async()=>cache,keys:async()=>[old,"smokehouse-admin-v6"],delete:async k=>{deleted.push(k);return true},match:async k=>stored.get(k)},
 self:{addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}},location:{origin:"https://admin.test"}}};
 vm.runInNewContext(fs.readFileSync("public/sw.js","utf8"),context);
 let wait;events.install({waitUntil:p=>wait=p});await wait;events.activate({waitUntil:p=>wait=p});await wait;
 return {stored,assets,deleted,events,context};
}
test("new worker replaces previously enabled shell with deployment-disabled HTML",async()=>{
 const w=await worker('<meta name="smokehouse-offline-pos" content="disabled"><p>Disabled</p>');assert.match(await w.stored.get("/pos-shell").text(),/Disabled/);assert.ok(w.deleted.includes("smokehouse-admin-v5"));assert.ok(!w.assets.some(x=>x.includes("_next")));
});
test("new worker rejects executable legacy POS shell lacking deployment marker",async()=>{
 const w=await worker('<script src="/_next/static/legacy.js"></script>');assert.ok(!w.stored.has("/pos-shell"));assert.ok(w.deleted.includes("/pos-shell"));assert.ok(!w.assets.includes("/_next/static/legacy.js"));
});
test("enabled worker precaches data-free shell and assets for cloud-free startup",async()=>{
 const w=await worker('<meta content="enabled" name="smokehouse-offline-pos"><script src="/_next/static/pos.js"></script>');assert.ok(w.stored.has("/pos-shell"));assert.ok(w.assets.includes("/_next/static/pos.js"));
});
test("disabled cached navigation returns disabled shell rather than authenticated Admin HTML",async()=>{
 const w=await worker('<meta name="smokehouse-offline-pos" content="disabled"><p>Disabled</p>');w.context.fetch=async()=>{throw Error("Internet unavailable")};let response;w.events.fetch({request:{method:"GET",mode:"navigate",url:"https://admin.test/pos"},respondWith:p=>response=p});assert.match(await (await response).text(),/Disabled/);
});

for(const enabled of [undefined,false])test("local client fails closed before login or submission when bridge activation is "+String(enabled),async()=>{
 const {loginLocal,localState}=loadTs("lib/pos/local-bridge.ts");const old=globalThis.fetch;let calls=0;const terminalId="00000000-0000-4000-8000-000000000001",epoch="00000000-0000-4000-8000-000000000002";
 globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({terminalId,epoch,...(enabled===undefined?{}:{cashSalesEnabled:enabled})})}};
 try{await assert.rejects(loginLocal("http://127.0.0.1:17891",terminalId,"91827364"),/disabled/);assert.equal(calls,1);await assert.rejects(localState({bridgeUrl:"http://127.0.0.1:17891",token:"synthetic",cashierId:terminalId,terminalId,epoch}),/disabled/);assert.equal(calls,2)}finally{globalThis.fetch=old;}
});
