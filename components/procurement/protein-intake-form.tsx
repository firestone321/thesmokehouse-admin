"use client";

import { useState } from "react";
import { recordProteinProcurementAction } from "@/lib/ops/actions";
import { ProteinProcurementCode } from "@/lib/ops/types";

const proteinLabels: Record<ProteinProcurementCode, string> = {
  beef: "Beef",
  whole_chicken: "Whole chicken",
  goat: "Goat meat"
};

const proteinUnitDefaults: Record<ProteinProcurementCode, string> = {
  beef: "kg",
  whole_chicken: "bird",
  goat: "kg"
};

function normalizeWholeChickenQuantity(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function ProteinIntakeForm({ defaultDeliveryDate }: { defaultDeliveryDate: string }) {
  const [proteinCode, setProteinCode] = useState<ProteinProcurementCode>("whole_chicken");
  const [unitName, setUnitName] = useState(proteinUnitDefaults.whole_chicken);
  const [quantityReceived, setQuantityReceived] = useState("0");
  const [allocatedToHalves, setAllocatedToHalves] = useState("0");
  const [allocatedToQuarters, setAllocatedToQuarters] = useState("0");

  const wholeChickensReceived = proteinCode === "whole_chicken" ? normalizeWholeChickenQuantity(quantityReceived) : 0;
  const halvesAllocation = proteinCode === "whole_chicken" ? normalizeWholeChickenQuantity(allocatedToHalves) : 0;
  const quartersAllocation = proteinCode === "whole_chicken" ? normalizeWholeChickenQuantity(allocatedToQuarters) : 0;
  const allocationTotal = halvesAllocation + quartersAllocation;
  const isAllocationValid = allocationTotal <= wholeChickensReceived;
  const maxHalves = wholeChickensReceived * 2;
  const maxQuarters = wholeChickensReceived * 4;
  const sellableHalves = halvesAllocation * 2;
  const sellableQuarters = quartersAllocation * 4;

  return (
    <form action={recordProteinProcurementAction} className="space-y-4">
      <section className="surface-card rounded-[32px] p-5">
        <div className="border-b border-[#EEF2F6] pb-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Protein Intake</p>
          <h2 className="mt-2 text-xl font-semibold">Receive raw protein deliveries</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
            Capture what came in, who supplied it, and how much the kitchen has available before production planning.
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
                if (nextProtein !== "whole_chicken") {
                  setAllocatedToHalves("0");
                  setAllocatedToQuarters("0");
                }
              }}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            >
              <option value="beef">Beef</option>
              <option value="whole_chicken">Whole chicken</option>
              <option value="goat">Goat</option>
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
            <button
              type="submit"
              disabled={proteinCode === "whole_chicken" && !isAllocationValid}
              className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:bg-[#9CA3AF]"
            >
              Record protein intake
            </button>
          </div>
        </div>
      </section>

      <section className="surface-card rounded-[32px] p-5">
        <div className="border-b border-[#EEF2F6] pb-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Chicken Yield Planning</p>
          <h2 className="mt-2 text-xl font-semibold">Allocate whole chickens before prep</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
            Theoretical yield is shown for planning only. These numbers do not become live sellable stock until a later
            production flow moves them into daily stock.
          </p>
        </div>

        {proteinCode === "whole_chicken" ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Whole chickens received</p>
                <p className="mt-2 text-2xl font-semibold text-[#111418]">{wholeChickensReceived}</p>
              </article>
              <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Max halves</p>
                <p className="mt-2 text-2xl font-semibold text-[#111418]">{maxHalves}</p>
              </article>
              <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Max quarters</p>
                <p className="mt-2 text-2xl font-semibold text-[#111418]">{maxQuarters}</p>
              </article>
              <article className="rounded-[22px] bg-[#FFF9F2] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#C2410C]">Allocation balance</p>
                <p className={`mt-2 text-2xl font-semibold ${isAllocationValid ? "text-[#111418]" : "text-[#D32F2F]"}`}>
                  {wholeChickensReceived - allocationTotal}
                </p>
              </article>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <label className="space-y-2 text-sm text-[#6B7280]">
                <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Chickens allocated to halves</span>
                <input
                  type="number"
                  min="0"
                  max={wholeChickensReceived.toString()}
                  name="allocated_to_halves"
                  value={allocatedToHalves}
                  onChange={(event) => setAllocatedToHalves(event.target.value)}
                  className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                />
              </label>

              <label className="space-y-2 text-sm text-[#6B7280]">
                <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Chickens allocated to quarters</span>
                <input
                  type="number"
                  min="0"
                  max={wholeChickensReceived.toString()}
                  name="allocated_to_quarters"
                  value={allocatedToQuarters}
                  onChange={(event) => setAllocatedToQuarters(event.target.value)}
                  className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <article className="rounded-[22px] border border-[#E4E7EB] bg-white px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Sellable halves from allocation</p>
                <p className="mt-2 text-2xl font-semibold text-[#111418]">{sellableHalves}</p>
              </article>
              <article className="rounded-[22px] border border-[#E4E7EB] bg-white px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Sellable quarters from allocation</p>
                <p className="mt-2 text-2xl font-semibold text-[#111418]">{sellableQuarters}</p>
              </article>
            </div>

            {!isAllocationValid ? (
              <p className="rounded-[22px] bg-[#FDECEC] px-4 py-3 text-sm leading-6 text-[#B42318]">
                Halves allocation plus quarters allocation cannot be more than the whole chickens received.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 rounded-[24px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
            Switch the protein above to <span className="font-semibold text-[#111418]">Whole chicken</span> to plan half
            and quarter allocation before production.
          </div>
        )}

        {proteinCode !== "whole_chicken" ? (
          <>
            <input type="hidden" name="allocated_to_halves" value="0" />
            <input type="hidden" name="allocated_to_quarters" value="0" />
          </>
        ) : null}
      </section>
    </form>
  );
}
