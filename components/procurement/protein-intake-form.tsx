"use client";

import { useState } from "react";
import { recordProteinProcurementAction } from "@/lib/ops/actions";
import { ProteinProcurementCode } from "@/lib/ops/types";

const proteinLabels: Record<ProteinProcurementCode, string> = {
  beef_ribs: "Beef ribs",
  beef_chunks: "Beef chunks",
  whole_chicken: "Whole chicken",
  goat_ribs: "Goat ribs",
  goat_chunks: "Goat chunks",
  beef: "Beef",
  goat: "Goat meat"
};

const proteinUnitDefaults: Record<ProteinProcurementCode, string> = {
  beef_ribs: "kg",
  beef_chunks: "kg",
  whole_chicken: "bird",
  goat_ribs: "kg",
  goat_chunks: "kg",
  beef: "kg",
  goat: "kg"
};

const selectableProteinCodes: ProteinProcurementCode[] = [
  "beef_ribs",
  "beef_chunks",
  "whole_chicken",
  "goat_ribs",
  "goat_chunks"
];

export function ProteinIntakeForm({ defaultDeliveryDate }: { defaultDeliveryDate: string }) {
  const [proteinCode, setProteinCode] = useState<ProteinProcurementCode>("beef_ribs");
  const [unitName, setUnitName] = useState(proteinUnitDefaults.beef_ribs);
  const [quantityReceived, setQuantityReceived] = useState("0");

  return (
    <form action={recordProteinProcurementAction}>
      <section className="surface-card rounded-[32px] p-5">
        <div className="border-b border-[#EEF2F6] pb-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Protein Intake</p>
          <h2 className="mt-2 text-xl font-semibold">Receive raw protein deliveries</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
            Capture what came in, who supplied it, and how much the kitchen has available before processing.
          </p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Protein</span>
            <select
              name="protein_code"
              value={proteinCode}
              onChange={(event) => {
                const nextProtein = event.target.value as ProteinProcurementCode;
                setProteinCode(nextProtein);
                setUnitName(proteinUnitDefaults[nextProtein]);
              }}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            >
              {selectableProteinCodes.map((code) => (
                <option key={code} value={code}>
                  {proteinLabels[code]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Supplier</span>
            <input
              name="supplier_name"
              required
              placeholder="Ugachick, trusted butcher, farm name"
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Delivery date</span>
            <input
              type="date"
              name="delivery_date"
              required
              defaultValue={defaultDeliveryDate}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Quantity received</span>
            <input
              type="number"
              min="0"
              step={proteinCode === "whole_chicken" ? "1" : "0.01"}
              name="quantity_received"
              required
              value={quantityReceived}
              onChange={(event) => setQuantityReceived(event.target.value)}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Unit label</span>
            <input
              name="unit_name"
              required
              value={unitName}
              onChange={(event) => setUnitName(event.target.value)}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Unit cost</span>
            <input
              type="number"
              min="0"
              step="0.01"
              name="unit_cost"
              placeholder="Optional"
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280] lg:col-span-2">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Notes</span>
            <textarea
              name="note"
              rows={3}
              placeholder={`Arrival notes for this ${proteinLabels[proteinCode].toLowerCase()} delivery`}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-[#111418]"
            />
          </label>

          <div className="lg:col-span-2">
            <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
              Record protein intake
            </button>
          </div>
        </div>
        <input type="hidden" name="allocated_to_halves" value="0" />
        <input type="hidden" name="allocated_to_quarters" value="0" />
      </section>
    </form>
  );
}
