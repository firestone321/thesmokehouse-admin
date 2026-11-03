"use client";
import {useEffect,useState} from "react";
import {PosSaleWorkspace} from "./pos-sale-workspace";
import {DashboardShell} from "@/components/dashboard/dashboard-shell";
import {loadDisplaySnapshot} from "@/lib/pos/offline-display";
import type {PosMenuItem} from "@/lib/pos/types";
export function OfflinePosEntry(){
 const [entry,setEntry]=useState<{cashierId:string;bridgeUrl:string;items:PosMenuItem[]}|null>(null);
 useEffect(()=>{try{const raw=localStorage.getItem("smokehouse-pos-entry-v1");if(!raw||raw.length>1024)return;const e=JSON.parse(raw);if(!/^[a-f0-9-]{36}$/i.test(e.cashierId)||!/^http:\/\/127\.0\.0\.1:\d+$/.test(e.bridgeUrl))return;const items=loadDisplaySnapshot(sessionStorage,e.cashierId).map(m=>({...m,name:"",basePrice:0,availableQuantity:0}));setEntry({...e,items});}catch{}},[]);
 return <DashboardShell userRole="cashier">{entry?<PosSaleWorkspace cashierId={entry.cashierId} cashierEmail={null} menuItems={entry.items} bridgeUrl={entry.bridgeUrl} offlineOnly canRecordSales onlineReceiptPrintBacklog={{pendingCount:0,oldestPendingAt:null,printerStationRegistered:false,jobs:[]}}/>:<p role="alert" className="surface-card rounded-2xl p-4">Open the POS on this browser while connected and prepare this terminal before using offline cash sales.</p>}</DashboardShell>;
}
