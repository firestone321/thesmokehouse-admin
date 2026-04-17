"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createSupplierInlineAction, recordProteinProcurementAction } from "@/lib/ops/actions";
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
  const [supplierOptions, setSupplierOptions] = useState(suppliers);
  const [proteinCode, setProteinCode] = useState<ProteinProcurementCode>("beef_ribs");
  const [unitName, setUnitName] = useState(proteinUnitDefaults.beef_ribs);
  const [quantityReceived, setQuantityReceived] = useState("0");
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate);
  const [supplierId, setSupplierId] = useState<string>(suppliers[0] ? String(suppliers[0].id) : "");
  const [abattoirName, setAbattoirName] = useState(suppliers[0]?.defaultAbattoirName ?? "");
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(suppliers.length === 0);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [quickAddSuccess, setQuickAddSuccess] = useState<string | null>(null);
  const [isCreatingSupplier, startCreateSupplierTransition] = useTransition();
  const [batchPreviewTime, setBatchPreviewTime] = useState(() => {
    const now = new Date();
    const timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Kampala",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });

    return timeFormatter.format(now).replaceAll(":", "");
  });

  const selectedSupplier = useMemo(
    () => supplierOptions.find((supplier) => String(supplier.id) === supplierId) ?? null,
    [supplierId, supplierOptions]
  );
  const batchPreviewValue = `${proteinCode.toUpperCase()}-${deliveryDate.replaceAll("-", "")}-${batchPreviewTime}`;

  useEffect(() => {
    setSupplierOptions(suppliers);
    setSupplierId((currentSupplierId) => currentSupplierId || (suppliers[0] ? String(suppliers[0].id) : ""));
  }, [suppliers]);

  useEffect(() => {
    setAbattoirName(selectedSupplier?.defaultAbattoirName ?? "");
  }, [selectedSupplier?.id, selectedSupplier?.defaultAbattoirName]);

  useEffect(() => {
    const updatePreviewTime = () => {
      const now = new Date();
      const timeFormatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Kampala",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });

      setBatchPreviewTime(timeFormatter.format(now).replaceAll(":", ""));
    };

    updatePreviewTime();
    const timer = window.setInterval(updatePreviewTime, 1000);

    return () => window.clearInterval(timer);
  }, []);

  async function handleQuickAddSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuickAddError(null);
    setQuickAddSuccess(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    if (formData.get("is_active") !== "on") {
      formData.set("is_active", "on");
    }

    startCreateSupplierTransition(async () => {
      try {
        const result = await createSupplierInlineAction(formData);

        if (!result.ok) {
          setQuickAddError("Unable to create supplier.");
          return;
        }

        setSupplierOptions((currentSuppliers) => {
          const nextSuppliers = currentSuppliers.filter((supplier) => supplier.id !== result.supplier.id);
          nextSuppliers.push({
            id: result.supplier.id,
            name: result.supplier.name,
            phoneNumber: result.supplier.phoneNumber,
            licenseNumber: result.supplier.licenseNumber,
            supplierType: result.supplier.supplierType,
            defaultAbattoirName: result.supplier.defaultAbattoirName
          });

          nextSuppliers.sort((left, right) => left.name.localeCompare(right.name));
          return nextSuppliers;
        });

        setSupplierId(String(result.supplier.id));
        setAbattoirName(result.supplier.defaultAbattoirName ?? "");
        setQuickAddSuccess(`${result.supplier.name} is ready to use for this intake.`);
        setIsQuickAddOpen(false);
        form.reset();
      } catch (error) {
        setQuickAddError(error instanceof Error ? error.message : "Unable to create supplier.");
      }
    });
  }

  return (
    <section className="surface-card rounded-[32px] p-5">
      <div className="border-b border-[#EEF2F6] pb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Protein Intake</p>
        <h2 className="mt-2 text-xl font-semibold">Receive raw protein deliveries</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
          Capture the supplier and meat inspection details first, then record the received quantity for processing.
          The batch number is generated automatically when the receipt is saved.
        </p>
      </div>

      {isQuickAddOpen ? (
        <div className="mt-4 rounded-[24px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Quick Add Supplier</p>
              <h3 className="mt-2 text-lg font-semibold text-[#111418]">Create and use a supplier without leaving intake</h3>
            </div>
            <Link href="/suppliers" className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2 text-sm font-semibold text-[#111418]">
              Open suppliers page
            </Link>
          </div>

          <form onSubmit={handleQuickAddSupplier} className="mt-4 grid gap-3 lg:grid-cols-2">
            <input
              name="name"
              required
              placeholder="Supplier name"
              className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
            />
            <select
              name="supplier_type"
              defaultValue="protein"
              className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
            >
              <option value="protein">Protein supplier</option>
              <option value="mixed">Mixed supplier</option>
            </select>
            <input
              name="phone_number"
              placeholder="Phone number"
              className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
            />
            <input
              name="license_number"
              placeholder="License number"
              className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
            />
            <input
              name="default_abattoir_name"
              placeholder="Default abattoir name"
              className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418] lg:col-span-2"
            />
            <textarea
              name="notes"
              rows={3}
              placeholder="Receiving notes or supplier context"
              className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-sm text-[#111418] lg:col-span-2"
            />
            <label className="flex items-center gap-2 text-sm text-[#6B7280] lg:col-span-2">
              <input type="checkbox" name="is_active" defaultChecked />
              Active supplier
            </label>
            {quickAddError ? (
              <div className="rounded-[20px] border border-[#F4C7C7] bg-[#FFF8F8] px-4 py-3 text-sm leading-6 text-[#8A1C1C] lg:col-span-2">
                {quickAddError}
              </div>
            ) : null}
            {quickAddSuccess ? (
              <div className="rounded-[20px] border border-[#CFE8D6] bg-[#F2FBF5] px-4 py-3 text-sm leading-6 text-[#166534] lg:col-span-2">
                {quickAddSuccess}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={isCreatingSupplier}
              className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 lg:col-span-2"
            >
              {isCreatingSupplier ? "Creating supplier..." : "Create supplier and use it"}
            </button>
          </form>
        </div>
      ) : null}

      <form action={recordProteinProcurementAction} className="mt-4">
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Supplier</span>
            <select
              name="supplier_id"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              disabled={supplierOptions.length === 0}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            >
              {supplierOptions.length === 0 ? <option value="">Create a supplier first</option> : null}
              {supplierOptions.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setIsQuickAddOpen((currentValue) => !currentValue);
                setQuickAddError(null);
                setQuickAddSuccess(null);
              }}
              className="text-left text-xs font-semibold text-[#111418] underline underline-offset-4"
            >
              {isQuickAddOpen ? "Close quick add supplier" : "Quick add supplier"}
            </button>
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
              value={batchPreviewValue}
              readOnly
              disabled
              className="w-full rounded-2xl border border-[#D7DDE4] bg-[#F8FAFB] px-3 py-2.5 text-[#111418] opacity-100"
            />
            <p className="text-xs leading-5 text-[#6B7280]">
              Generated automatically when the receipt is saved using the protein code, delivery date, and Kampala time.
            </p>
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
          <button
            type="submit"
            disabled={supplierOptions.length === 0}
            className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            Record protein intake
          </button>
          <Link href="/suppliers" className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]">
            Manage suppliers
          </Link>
        </div>
        {supplierOptions.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-[#6B7280]">
            Supplier traceability is required before a meat receipt can be recorded. Use quick add above or open the suppliers page.
          </p>
        ) : null}
        <input type="hidden" name="allocated_to_halves" value="0" />
        <input type="hidden" name="allocated_to_quarters" value="0" />
      </form>
    </section>
  );
}
