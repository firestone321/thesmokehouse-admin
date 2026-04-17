"use client";

import Link from "next/link";
import { useState } from "react";
import { SupplierRecord, SupplierType } from "@/lib/ops/types";
import { formatDateTime } from "@/lib/ops/utils";

function formatSupplierType(value: SupplierType) {
  switch (value) {
    case "mixed":
      return "Mixed";
    case "supply":
      return "Supply";
    default:
      return "Protein";
  }
}

export function SavedSuppliersList({
  suppliers,
  selectedSupplierId
}: {
  suppliers: SupplierRecord[];
  selectedSupplierId?: number | null;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(selectedSupplierId ?? null);

  if (suppliers.length === 0) {
    return (
      <div className="rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
        No suppliers exist yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {suppliers.map((supplier) => {
        const isExpanded = expandedId === supplier.id;

        return (
          <article
            key={supplier.id}
            className={`rounded-xl border ${
              selectedSupplierId === supplier.id ? "border-[#111418] bg-[#F8FAFB]" : "border-slate-200 bg-white"
            }`}
          >
            <button
              type="button"
              className="flex w-full items-start gap-3 p-3 text-left sm:p-4"
              onClick={() => {
                setExpandedId((current) => (current === supplier.id ? null : supplier.id));
              }}
              aria-expanded={isExpanded}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-slate-900">{supplier.name}</p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      supplier.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {supplier.isActive ? "active" : "inactive"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-700">
                  {formatSupplierType(supplier.supplierType)}
                  {supplier.licenseNumber ? ` | ${supplier.licenseNumber}` : ""}
                </p>
              </div>
              <span
                className={`mt-1 shrink-0 text-sm text-slate-400 transition-transform duration-200 ${
                  isExpanded ? "rotate-180" : "rotate-0"
                }`}
              >
                v
              </span>
            </button>

            <div
              className={`grid transition-all duration-200 ease-out ${
                isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <div className="border-t border-slate-200 px-3 pb-4 pt-3 sm:px-4">
                  <div className="grid gap-3 text-sm text-slate-600">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Phone</p>
                      <p className="mt-1 text-slate-800">{supplier.phoneNumber ?? "Not set"}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Default abattoir</p>
                      <p className="mt-1 text-slate-800">{supplier.defaultAbattoirName ?? "Not set"}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Updated</p>
                      <p className="mt-1 text-slate-800">{formatDateTime(supplier.updatedAt)}</p>
                    </div>
                    {supplier.notes ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Notes</p>
                        <p className="mt-1 text-slate-800">{supplier.notes}</p>
                      </div>
                    ) : null}
                    <Link
                      href={`/suppliers?supplier=${supplier.id}`}
                      className="inline-flex items-center justify-center rounded-xl bg-[#111418] px-3 py-2 text-sm font-semibold text-white"
                    >
                      Open supplier
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
