"use client";
import {useState} from "react";
export function RecoveryEvidenceUpload(){
 const [permit,setPermit]=useState(""),[message,setMessage]=useState(""),[file,setFile]=useState<File|null>(null);
 return <form onSubmit={async e=>{e.preventDefault();try{if(!file||file.size>2000000)throw Error("Choose a recovery evidence batch below 2 MB.");
 const data=JSON.parse(await file.text());if(data.permitId!==permit)throw Error("This batch belongs to a different recovery permit.");
 const r=await fetch("/api/admin/pos/offline/recovery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
 setMessage(JSON.stringify(await r.json()));}catch(error){setMessage((error as Error).message);}}}>
 <label>Recovery permit identity<input value={permit} onChange={e=>setPermit(e.target.value)} required className="rounded border p-2"/></label>
 <input type="file" accept="application/json" onChange={e=>setFile(e.target.files?.[0]||null)} required/><button>Archive verified historical evidence for review</button><pre className="whitespace-pre-wrap">{message}</pre></form>;
}
