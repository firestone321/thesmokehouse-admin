// Real Chromium IndexedDB/Web Locks tests on a synthetic localhost origin.
// Never loads the admin app, Supabase configuration, payment API or hardware.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

test("real browser: IndexedDB survives refresh/restart, cashier isolation and Web Locks coordinate tabs", {timeout:90_000}, async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),"smokehouse-pos-browser-test-"));
  const modules={};
  for(const name of ["attempt-store","sale-contract"])
    modules["/"+name+".js"]=ts.transpileModule(await readFile("lib/pos/"+name+".ts","utf8"),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  const server=createServer((req,res)=>{res.setHeader("Content-Type",modules[req.url]?"text/javascript":"text/html");res.end(modules[req.url]||"<!doctype html><title>POS synthetic storage test</title>");});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const origin="http://127.0.0.1:"+server.address().port;
  let child,socket,seq=0;const pending=new Map(),listeners=new Set();
  async function start(){
    child=spawn(process.env.POS_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
      ["--headless=new","--no-first-run","--no-default-browser-check","--disable-background-networking","--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
    const url=await new Promise((resolve,reject)=>{
      let text="";const timeout=setTimeout(()=>reject(Error("Headless browser startup timed out")),20_000);
      child.once("error",e=>{clearTimeout(timeout);reject(e);});
      child.stderr.on("data",chunk=>{text+=chunk.toString();const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    });
    socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
    socket.addEventListener("message",event=>{
      const msg=JSON.parse(event.data);
      if(msg.id){const callback=pending.get(msg.id);pending.delete(msg.id);if(msg.error)callback?.reject(Error(msg.error.message));else callback?.resolve(msg.result);}
      else for(const listener of listeners)listener(msg);
    });
  }
  function send(method,params={},sessionId){
    return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  }
  async function tab(){
    const {targetId}=await send("Target.createTarget",{url:"about:blank"});
    const {sessionId}=await send("Target.attachToTarget",{targetId,flatten:true});
    await send("Page.enable",{},sessionId);
    const loaded=new Promise(resolve=>{const listener=msg=>{if(msg.method==="Page.loadEventFired"&&msg.sessionId===sessionId){listeners.delete(listener);resolve();}};listeners.add(listener);});
    await send("Page.navigate",{url:origin},sessionId);await loaded;
    return sessionId;
  }
  async function evaluate(sessionId,expression){
    const result=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function stop(){
    if(!child)return;const exited=new Promise(resolve=>child.once("exit",resolve));
    await send("Browser.close").catch(()=>{});await exited;socket?.close();child=null;
  }
  try{
    await start();const first=await tab();
    const key=await evaluate(first,`(async()=>{
      const s=await import("/attempt-store.js"), c=await import("/sale-contract.js");
      const a=c.newAttempt("cashier-a",{idempotencyKey:crypto.randomUUID(),tenderType:"cash",amountReceived:100,items:[{menuItemId:1,quantity:1}]});
      a.state="submitting";await s.saveAttempt(a);return a.payload.idempotencyKey;
    })()`);
    // A fresh document/module instance must recover the exact identity and payload.
    const second=await tab();
    assert.deepEqual(await evaluate(second,`(async()=>{const s=await import("/attempt-store.js"),a=await s.readActiveAttempt("cashier-a");return [a.payload.idempotencyKey,a.state,a.payload.items[0].quantity,await s.readActiveAttempt("cashier-b")];})()`),[key,"submitting",1,null]);
    await evaluate(first,`(async()=>{const s=await import("/attempt-store.js");window.acquired=new Promise(resolve=>{window.hold=s.withSaleLock("cashier-a",async()=>{resolve(true);await new Promise(r=>window.release=r);});});})()`);
    assert.equal(await evaluate(first,"window.acquired"),true);
    assert.equal(await evaluate(second,`(async()=>{const s=await import("/attempt-store.js");try{await s.withSaleLock("cashier-a",async()=>{});return false;}catch{return true;}})()`),true);
    await evaluate(first,"window.release();window.hold");
    await stop();await start();const restarted=await tab();
    assert.equal(await evaluate(restarted,`(async()=>{const s=await import("/attempt-store.js");return (await s.readActiveAttempt("cashier-a")).payload.idempotencyKey;})()`),key);
    assert.deepEqual(await evaluate(restarted,`(async()=>{const s=await import("/attempt-store.js"),c=await import("/sale-contract.js");const a=c.restoreAttempt(await s.readActiveAttempt("cashier-a"));await s.saveAttempt(a);return [a.state,a.payload.idempotencyKey];})()`),["outcome_unknown",key]);
  }finally{
    await stop();await new Promise(r=>server.close(r));
    if(!profile.startsWith(path.join(os.tmpdir(),"smokehouse-pos-browser-test-")))throw Error("Unsafe test cleanup target");
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
