"use client";
import {useEffect} from "react";
import {ordersContext,invalidateOrdersSnapshots} from "@/lib/orders/offline-cache";
export function OfflineOrdersIdentity({userId,role,sessionHash}:{userId:string|null;role:string|null;sessionHash:string|null}){
 useEffect(()=>{const ctx=ordersContext();if(ctx&&(ctx.userId!==userId||!sessionHash||ctx.authSessionHash!==sessionHash||!['admin','manager','staff','chef'].includes(role||"")))void invalidateOrdersSnapshots();},[userId,role,sessionHash]);return null;
}
