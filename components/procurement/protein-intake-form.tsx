"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { recordProteinProcurementAction } from "@/lib/ops/actions";
import { ProcurementSupplierOption, ProteinProcurementCode } from "@/lib/ops/types";

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

function formatSupplierType(value: ProcurementSupplierOption["supplierType"]) {
  switch (value) {
    case "mixed":
      return "Mixed supplier";
    case "supply":
      return "Supply supplier";
    default:
      return "Protein supplier";
  }
}

export function ProteinIntakeForm({
  defaultDeliveryDate,
  suppliers
}: {
  defaultDeliveryDate: string;
  suppliers: ProcurementSupplierOption[];
}) {
  const [proteinCode, setProteinCode] = useState<ProteinProcurementCode>("beef_ribs");
  const [unitName, setUnitName] = useState(proteinUnitDefaults.beef_ribs);
  const [quantityReceived, setQuantityReceived] = useState("0");
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate);
  const [supplierId, setSupplierId] = useState<string>(suppliers[0] ? String(suppliers[0].id) : "");
  const [abattoirName, setAbattoirName] = useState(suppliers[0]?.defaultAbattoirName ?? "");

  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => String(supplier.id) === supplierId) ?? null,
    [supplierId, suppliers]
  );

  useEffect(() => {
    setAbattoirName(selectedSupplier?.defaultAbattoirName ?? "");
  }, [selectedSupplier?.id, selectedSupplier?.defaultAbattoirName]);

  if (suppliers.length === 0) {
    return (
      <section className="surface-card rounded-[32px] p-5">
        <div className="border-b border-[#EEF2F6] pb-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Protein Intake</p>
          <h2 className="mt-2 text-xl font-semibold">Receive raw protein deliveries</h2>
        </div>
        <div className="mt-4 rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
          Supplier traceability is now required for meat receipts. Add at least one active supplier on the{" "}
          <Link href="/suppliers" className="font-semibold text-[#111418] underline underline-offset-4">
            Suppliers page
          </Link>{" "}
          before recording protein intake.
        </div>
      </section>
    );
  }

  return (
    <form action={recordProteinProcurementAction}>
      <section className="surface-card rounded-[32px] p-5">
        <div className="border-b border-[#EEF2F6] pb-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Protein Intake</p>
          <h2 className="mt-2 text-xl font-semibold">Receive raw protein deliveries</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
            Capture the supplier, batch, and meat inspection details first, then record the received quantity for
            processing.
          </p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Supplier</span>
            <select
              name="supplier_id"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            >
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>

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
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Batch number</span>
            <input
              name="batch_number"
              required
              placeholder={`Example: ${proteinCode.toUpperCase()}-${deliveryDate.replaceAll("-", "")}-01`}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Date received</span>
            <input
              type="date"
              name="delivery_date"
              required
              value={deliveryDate}
              onChange={(event) => setDeliveryDate(event.target.value)}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Butchered date</span>
            <input
              type="date"
              name="butchered_on"
              required
              defaultValue={defaultDeliveryDate}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Abattoir name</span>
            <input
              name="abattoir_name"
              required
              value={abattoirName}
              onChange={(event) => setAbattoirName(event.target.value)}
              placeholder="Processing or slaughter location"
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Vet stamp number</span>
            <input
              name="vet_stamp_number"
              required
              placeholder="Inspection stamp reference"
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Inspection officer</span>
            <input
              name="inspection_officer_name"
              required
              placeholder="Officer who signed off the meat"
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
              placeholder={`Receiving notes for this ${proteinLabels[proteinCode].toLowerCase()} batch`}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-[#111418]"
            />
          </label>
        </div>

        {selectedSupplier ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Supplier details</p>
              <p className="mt-2 text-base font-semibold text-[#111418]">{selectedSupplier.name}</p>
              <p className="mt-1 text-sm leading-6 text-[#6B7280]">{formatSupplierType(selectedSupplier.supplierType)}</p>
            </article>
            <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Phone / license</p>
              <p className="mt-2 text-sm leading-6 text-[#6B7280]">{selectedSupplier.phoneNumber ?? "No phone recorded"}</p>
              <p className="mt-1 text-sm leading-6 text-[#6B7280]">{selectedSupplier.licenseNumber ?? "No license recorded"}</p>
            </article>
            <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Default abattoir</p>
              <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                {selectedSupplier.defaultAbattoirName ?? "No default abattoir saved yet"}
              </p>
            </article>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
            Record protein intake
          </button>
          <Link href="/suppliers" className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]">
            Manage suppliers
          </Link>
        </div>
        <input type="hidden" name="allocated_to_halves" value="0" />
        <input type="hidden" name="allocated_to_quarters" value="0" />
      </section>
    </form>
  );
}
