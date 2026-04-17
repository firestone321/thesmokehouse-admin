"use client";

import { useMemo, useState } from "react";
import { SupplierSupplyHistoryRecord } from "@/lib/ops/types";

function formatHistoryDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium"
  }).format(new Date(`${value}T00:00:00+03:00`));
}

function formatQuantity(entry: SupplierSupplyHistoryRecord) {
  return `${entry.quantityReceived} ${entry.unitName}`;
}

function getSearchValue(entry: SupplierSupplyHistoryRecord) {
  return [
    entry.supplierName,
    entry.itemName,
    entry.batchNumber,
    entry.intakeType,
    entry.abattoirName,
    entry.vetStampNumber,
    entry.inspectionOfficerName,
    entry.note
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

export function SupplierSupplyHistory({
  history
}: {
  history: SupplierSupplyHistoryRecord[];
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredHistory = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return history;
    }

    return history.filter((entry) => getSearchValue(entry).includes(normalizedSearch));
  }, [history, searchTerm]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search supplier, item, batch, abattoir, or note"
        className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
      />

      {filteredHistory.length === 0 ? (
        <div className="rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
          No supply history matches the current search.
        </div>
      ) : (
        filteredHistory.map((entry) => {
          const isExpanded = expandedId === entry.id;

          return (
            <article key={entry.id} className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-start gap-2 p-3 sm:p-4">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  onClick={() => {
                    setExpandedId((current) => (current === entry.id ? null : entry.id));
                  }}
                  aria-expanded={isExpanded}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="truncate text-base font-semibold text-slate-900 sm:text-[15px]">
                        {entry.supplierName}
                      </p>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {entry.intakeType}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-700">{entry.itemName}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                        {entry.batchNumber ?? "No batch number"}
                      </span>
                      <span>{formatQuantity(entry)}</span>
                      <span>{formatHistoryDate(entry.deliveryDate)}</span>
                      {entry.abattoirName ? <span>{entry.abattoirName}</span> : null}
                    </div>
                  </div>
                  <span
                    className={`mt-1 shrink-0 text-sm text-slate-400 transition-transform duration-200 ${
                      isExpanded ? "rotate-180" : "rotate-0"
                    }`}
                  >
                    v
                  </span>
                </button>
              </div>

              <div
                className={`grid transition-all duration-200 ease-out ${
                  isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="border-t border-slate-200 px-3 pb-4 pt-3 sm:px-4">
                    <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Supplier</p>
                        <p className="mt-1 text-slate-800">{entry.supplierName}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Batch number</p>
                        <p className="mt-1 text-slate-800">{entry.batchNumber ?? "Not set"}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Protein or item</p>
                        <p className="mt-1 text-slate-800">{entry.itemName}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Received quantity</p>
                        <p className="mt-1 text-slate-800">{formatQuantity(entry)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Delivery date</p>
                        <p className="mt-1 text-slate-800">{formatHistoryDate(entry.deliveryDate)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Butchered date</p>
                        <p className="mt-1 text-slate-800">{formatHistoryDate(entry.butcheredOn)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Abattoir</p>
                        <p className="mt-1 text-slate-800">{entry.abattoirName ?? "Not set"}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Vet stamp</p>
                        <p className="mt-1 text-slate-800">{entry.vetStampNumber ?? "Not set"}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Inspection officer</p>
                        <p className="mt-1 text-slate-800">{entry.inspectionOfficerName ?? "Not set"}</p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Notes</p>
                      <p className="mt-1 text-slate-800">{entry.note ?? "No notes captured for this intake."}</p>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}
