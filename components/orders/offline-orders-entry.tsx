"use client";
import {useEffect,useState} from "react";
import {DashboardShell} from "@/components/dashboard/dashboard-shell";
import {ordersContext,type OrdersContext} from "@/lib/orders/offline-cache";
import {OfflineOrders} from "./offline-orders";
export function OfflineOrdersEntry(){const [context,setContext]=useState<OrdersContext|null>(null);useEffect(()=>setContext(ordersContext()),[]);return <DashboardShell userRole="staff">{context?<div className="space-y-4 text-[#111418]"><OfflineOrders userId={context.userId} bridgeUrl={context.bridgeUrl} readOnly/></div>:<p role="alert" className="surface-card rounded-2xl p-4">Prepare offline Orders for this user and browser session while connected before opening cached Orders.</p>}</DashboardShell>;}
