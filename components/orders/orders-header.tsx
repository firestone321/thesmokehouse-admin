"use client";
import Link from "next/link";
import type {ReactNode} from "react";
export function OrdersHeader({status,search,recoveryForm,readOnly=false,onFilter}:{status:string;search:string;recoveryForm?:ReactNode;readOnly?:boolean;onFilter?:(status:string,search:string)=>void}){return (
<section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Orders</p>
        <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Live order flow</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              This list is now backed by Supabase orders, items, payment state, and status event history. Paid orders
              enter the kitchen flow automatically, so staff only need to pick them up at prep time.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:min-w-[760px]">
            <Link
              href={readOnly?"/orders":"/orders/history"} aria-disabled={readOnly} onClick={readOnly?(e)=>e.preventDefault():undefined}
              className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]"
            >
              Order history
            </Link>

            {recoveryForm ?? <button type="button" disabled className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]">Recover payments</button>}

            <form onSubmit={readOnly?(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);onFilter?.(String(f.get("status")||"all"),String(f.get("search")||""));}:undefined} className="grid flex-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
              <label className="space-y-2 text-sm text-[#6B7280]">
                <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Status</span>
                <select
                  name="status"
                  defaultValue={status}
                  className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                >
                  <option value="all">All statuses</option>
                  <option value="new">New</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="in_prep">In prep</option>
                  <option value="ready">Ready</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>

              <label className="space-y-2 text-sm text-[#6B7280]">
                <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Search</span>
                <input
                  type="search"
                  name="search"
                  defaultValue={search}
                  placeholder={readOnly?"Cached order number or item":"Order number, customer, phone"}
                  className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                />
              </label>

              <button
                type="submit"
                className="self-end rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white"
              >
                Apply
              </button>
            </form>
          </div>
        </div>
      </section>);}
