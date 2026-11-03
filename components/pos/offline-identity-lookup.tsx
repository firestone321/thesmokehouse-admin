"use client";
import {useState} from "react";
export function OfflineIdentityLookup(){
 const [id,setId]=useState(""),[message,setMessage]=useState("");
 return <form onSubmit={async e=>{e.preventDefault();try{const r=await fetch("/api/admin/pos/offline/lookup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({transactionId:id})});const d=await r.json();setMessage(r.ok?JSON.stringify(d):"Lookup is unavailable or not authorized. Do not recreate the sale.");}catch{setMessage("Cloud lookup is unavailable; another terminal's local journal remains unknown.");}}}>
 <label>Original transaction ID<input value={id} onChange={e=>setId(e.target.value)} required className="rounded border p-2"/></label><button>Look up original identity</button><p role="status">{message}</p></form>;
}
