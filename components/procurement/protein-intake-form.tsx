"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { UgxAmountInput } from "@/components/ugx-amount-input";
import {
  createProteinIntakeItemInlineAction,
  createSupplierInlineAction,
  recordProteinProcurementAction
} from "@/lib/ops/actions";
import {
  ProcurementPortionOption,
  ProcurementSupplierOption,
  ProteinFamilyOption,
  ProteinIntakeItemOption
} from "@/lib/ops/types";

function formatSupplierType(value: ProcurementSupplierOption["supplierType"]) {
  switch (value) {
    case "mixed":
      return "Mixed supplier";
    case "ingredient":
      return "Ingredient supplier";
    case "supply":
      return "Supply supplier";
    default:
      return "Protein supplier";
  }
}

const intakeFieldClassName =
  "min-h-12 w-full rounded-2xl border border-[#CDD4DC] bg-[#FFFDF9] px-3 py-3 text-sm text-[#111418] shadow-sm transition hover:border-[#AEB8C3] hover:shadow-md focus:border-[#B85C38] focus:outline-none focus:ring-4 focus:ring-[#B85C38]/10";

const intakeSelectClassName = intakeFieldClassName + " cursor-pointer appearance-none pr-11";

const intakeLabelClassName = "block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#707782]";

const intakeSectionClassName = "grid gap-4 border-t border-[#E8E2DB] pt-6";

function IntakeSelectChevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="pointer-events-none absolute right-3.5 top-1/2 size-5 -translate-y-1/2 text-[#76513E] transition-colors group-hover:text-[#B85C38] group-focus-within:text-[#B85C38]"
      aria-hidden="true"
    >
      <path d="m5.5 7.5 4.5 4.5 4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SupplierSummaryIcon({ type }: { type: "supplier" | "contact" | "abattoir" }) {
  const paths = {
    supplier: <path d="M4 20h16M6 20V8l6-4 6 4v12M9 12h6M9 16h6" />,
    contact: <path d="M7 3h3l1.5 4-2 1.5a14 14 0 0 0 6 6L17 12l4 1.5v3c0 1.4-1.1 2.5-2.5 2.5C11 19 5 13 5 5.5 5 4.1 6 3 7 3Z" />,
    abattoir: <path d="M4 20h16M6 20V9h12v11M9 13h6M12 9V4M9 6h6" />
  } as const;

  return (
    <span className="flex size-8 items-center justify-center rounded-xl border border-[#DED8D1] bg-white text-[#6B625B]" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-4">
        {paths[type]}
      </svg>
    </span>
  );
}

export function ProteinIntakeForm({
  defaultDeliveryDate,
  suppliers,
  proteinFamilies,
  proteinIntakeItems,
  portionOptions
}: {
  defaultDeliveryDate: string;
  suppliers: ProcurementSupplierOption[];
  proteinFamilies: ProteinFamilyOption[];
  proteinIntakeItems: ProteinIntakeItemOption[];
  portionOptions: ProcurementPortionOption[];
}) {
  const [supplierOptions, setSupplierOptions] = useState(suppliers);
  const initialProteinItems = proteinIntakeItems.filter((item) => item.isActive);
  const [proteinItemOptions, setProteinItemOptions] = useState(initialProteinItems);
  const [proteinItemId, setProteinItemId] = useState(initialProteinItems[0] ? String(initialProteinItems[0].id) : "");
  const [unitName, setUnitName] = useState(initialProteinItems[0]?.defaultUnitName ?? "kg");
  const [quantityReceived, setQuantityReceived] = useState("0");
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate);
  const [supplierId, setSupplierId] = useState<string>(suppliers[0] ? String(suppliers[0].id) : "");
  const [abattoirName, setAbattoirName] = useState(suppliers[0]?.defaultAbattoirName ?? "");
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(suppliers.length === 0);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [quickAddSuccess, setQuickAddSuccess] = useState<string | null>(null);
  const [isCreatingSupplier, startCreateSupplierTransition] = useTransition();
  const [isQuickAddItemOpen, setIsQuickAddItemOpen] = useState(initialProteinItems.length === 0);
  const [quickAddItemError, setQuickAddItemError] = useState<string | null>(null);
  const [quickAddItemSuccess, setQuickAddItemSuccess] = useState<string | null>(null);
  const [isCreatingItem, startCreateItemTransition] = useTransition();
  const defaultQuickAddProteinFamilyId =
    proteinFamilies.find((protein) => protein.code === "beef")?.id ?? proteinFamilies[0]?.id;
  const [quickAddProteinFamilyId, setQuickAddProteinFamilyId] = useState(
    defaultQuickAddProteinFamilyId ? String(defaultQuickAddProteinFamilyId) : ""
  );
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
  const selectedProteinItem = useMemo(
    () => proteinItemOptions.find((item) => String(item.id) === proteinItemId) ?? null,
    [proteinItemId, proteinItemOptions]
  );
  const selectedQuickAddProteinFamily = useMemo(
    () => proteinFamilies.find((protein) => String(protein.id) === quickAddProteinFamilyId) ?? null,
    [proteinFamilies, quickAddProteinFamilyId]
  );
  const quickAddUnitName = selectedQuickAddProteinFamily?.code === "chicken" ? "bird" : "kg";
  const batchPreviewValue = `${(selectedProteinItem?.code ?? "PROTEIN").toUpperCase()}-${deliveryDate.replaceAll("-", "")}-${batchPreviewTime}`;

  useEffect(() => {
    setSupplierOptions(suppliers);
    setSupplierId((currentSupplierId) => currentSupplierId || (suppliers[0] ? String(suppliers[0].id) : ""));
  }, [suppliers]);

  useEffect(() => {
    const activeProteinItems = proteinIntakeItems.filter((item) => item.isActive);
    setProteinItemOptions(activeProteinItems);
    setProteinItemId((currentItemId) => currentItemId || (activeProteinItems[0] ? String(activeProteinItems[0].id) : ""));
  }, [proteinIntakeItems]);

  useEffect(() => {
    setQuickAddProteinFamilyId((currentFamilyId) => {
      if (proteinFamilies.some((protein) => String(protein.id) === currentFamilyId)) {
        return currentFamilyId;
      }

      const nextFamilyId = proteinFamilies.find((protein) => protein.code === "beef")?.id ?? proteinFamilies[0]?.id;
      return nextFamilyId ? String(nextFamilyId) : "";
    });
  }, [proteinFamilies]);

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

    let timerId: number | null = null;

    const start = () => {
      if (timerId !== null || document.visibilityState === "hidden") return;
      timerId = window.setInterval(updatePreviewTime, 1000);
    };
    const stop = () => {
      if (timerId === null) return;
      window.clearInterval(timerId);
      timerId = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }

      updatePreviewTime();
      start();
    };

    updatePreviewTime();
    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
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

  async function handleQuickAddProteinItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuickAddItemError(null);
    setQuickAddItemSuccess(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    startCreateItemTransition(async () => {
      try {
        const result = await createProteinIntakeItemInlineAction(formData);

        if (!result.ok) {
          setQuickAddItemError("Unable to create protein item.");
          return;
        }

        setProteinItemOptions((currentItems) => {
          const nextItems = currentItems.filter((item) => item.id !== result.item.id);
          nextItems.push(result.item);
          nextItems.sort((left, right) => left.name.localeCompare(right.name));
          return nextItems;
        });
        setProteinItemId(String(result.item.id));
        setUnitName(result.item.defaultUnitName);
        setQuickAddItemSuccess(`${result.item.name} is ready to receive and process.`);
        setIsQuickAddItemOpen(false);
        form.reset();
      } catch (error) {
        setQuickAddItemError(error instanceof Error ? error.message : "Unable to create protein item.");
      }
    });
  }

  return (
    <section className="surface-card rounded-[32px] p-5">
      <div className="border-b border-[#EEF2F6] pb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Protein Intake</p>
        <h2 className="mt-2 text-xl font-semibold">Receive meat deliveries</h2>
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
              className={intakeFieldClassName}
            />
            <select
              name="supplier_type"
              defaultValue="protein"
              className={intakeFieldClassName + " cursor-pointer"}
            >
              <option value="protein">Protein supplier</option>
              <option value="mixed">Mixed supplier</option>
            </select>
            <input
              name="phone_number"
              placeholder="Phone number"
              className={intakeFieldClassName}
            />
            <input
              name="license_number"
              placeholder="License number"
              className={intakeFieldClassName}
            />
            <input
              name="default_abattoir_name"
              placeholder="Default abattoir name"
              className={intakeFieldClassName + " lg:col-span-2"}
            />
            <textarea
              name="notes"
              rows={3}
              placeholder="Receiving notes or supplier context"
              className={intakeFieldClassName + " lg:col-span-2"}
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

      {isQuickAddItemOpen ? (
        <div className="mt-4 rounded-[24px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Quick Add Protein</p>
            <h3 className="mt-2 text-lg font-semibold text-[#111418]">Add a protein without leaving this receipt</h3>
            <p className="mt-2 text-sm leading-6 text-[#6B7280]">
              Link the raw item to the sellable menu portion it produces. Existing receipt details stay in place.
            </p>
          </div>

          <form onSubmit={handleQuickAddProteinItem} className="mt-4 grid gap-3 lg:grid-cols-2">
            <input
              name="name"
              required
              placeholder="Protein item, e.g. Beef Oxtail"
              className={intakeFieldClassName}
            />
            <label className="space-y-2 text-sm text-[#6B7280]">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Receiving unit</span>
              <select
                key={quickAddUnitName}
                name="default_unit_name"
                defaultValue={quickAddUnitName}
                className={intakeFieldClassName + " cursor-pointer"}
              >
                {quickAddUnitName === "bird" ? (
                  <option value="bird">Whole birds</option>
                ) : (
                  <option value="kg">Kilograms (kg)</option>
                )}
              </select>
              <p className="text-xs leading-5 text-[#6B7280]">
                {quickAddUnitName === "bird"
                  ? "Chicken deliveries are counted as whole birds."
                  : "Beef and goat deliveries are received by weight."}
              </p>
            </label>
            <label className="space-y-2 text-sm text-[#6B7280]">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Protein family</span>
              <select
                name="protein_id"
                required
                value={quickAddProteinFamilyId}
                onChange={(event) => setQuickAddProteinFamilyId(event.target.value)}
                disabled={proteinFamilies.length === 0}
                className={intakeFieldClassName + " cursor-pointer"}
              >
                {proteinFamilies.map((protein) => (
                  <option key={protein.id} value={protein.id}>
                    {protein.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm text-[#6B7280]">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Sellable portion</span>
              <select
                name="portion_type_id"
                required
                defaultValue={portionOptions.find((portion) => portion.code === "oxtail_portions")?.id ?? portionOptions[0]?.id}
                disabled={portionOptions.length === 0}
                className={intakeFieldClassName + " cursor-pointer"}
              >
                {portionOptions.map((portion) => (
                  <option key={portion.id} value={portion.id}>
                    {portion.name}{portion.portionLabel ? ` (${portion.portionLabel})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {quickAddItemError ? (
              <div className="rounded-[20px] border border-[#F4C7C7] bg-[#FFF8F8] px-4 py-3 text-sm leading-6 text-[#8A1C1C] lg:col-span-2">
                {quickAddItemError}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={isCreatingItem || proteinFamilies.length === 0 || portionOptions.length === 0}
              className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 lg:col-span-2"
            >
              {isCreatingItem ? "Creating protein item..." : "Create protein item and use it"}
            </button>
          </form>
        </div>
      ) : null}

      {quickAddItemSuccess ? (
        <div className="mt-4 rounded-[20px] border border-[#CFE8D6] bg-[#F2FBF5] px-4 py-3 text-sm leading-6 text-[#166534]">
          {quickAddItemSuccess}
        </div>
      ) : null}

      <form action={recordProteinProcurementAction} className="mt-6 grid gap-7">
        <div className="grid gap-4">
          <div>
            <p className="text-xs font-semibold text-[#2D2219]">Supplier</p>
            <p className="mt-1 text-xs leading-5 text-[#6B7280]">Choose who supplied the delivery and the protein received.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={intakeLabelClassName}>Supplier</span>
              <div className="group relative">
                <select
                  name="supplier_id"
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                  disabled={supplierOptions.length === 0}
                  className={intakeSelectClassName}
                >
                  {supplierOptions.length === 0 ? <option value="">Create a supplier first</option> : null}
                  {supplierOptions.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                <IntakeSelectChevron />
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsQuickAddOpen((currentValue) => !currentValue);
                  setQuickAddError(null);
                  setQuickAddSuccess(null);
                }}
                className="inline-flex min-h-9 w-fit items-center rounded-xl border border-[#B85C38] bg-white px-3 py-2 text-xs font-semibold text-[#A24E31] transition hover:bg-[#B85C38] hover:text-white focus:outline-none focus:ring-4 focus:ring-[#B85C38]/10"
              >
                {isQuickAddOpen ? "− Close supplier" : "+ Supplier"}
              </button>
            </label>

            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={intakeLabelClassName}>Protein</span>
              <div className="group relative">
                <select
                  name="protein_intake_item_id"
                  value={proteinItemId}
                  onChange={(event) => {
                    const nextItemId = event.target.value;
                    const nextItem = proteinItemOptions.find((item) => String(item.id) === nextItemId);
                    setProteinItemId(nextItemId);
                    setUnitName(nextItem?.defaultUnitName ?? "kg");
                  }}
                  disabled={proteinItemOptions.length === 0}
                  className={intakeSelectClassName}
                >
                  {proteinItemOptions.length === 0 ? <option value="">Create a protein item first</option> : null}
                  {proteinItemOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <IntakeSelectChevron />
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsQuickAddItemOpen((currentValue) => !currentValue);
                  setQuickAddItemError(null);
                  setQuickAddItemSuccess(null);
                }}
                className="inline-flex min-h-9 w-fit items-center rounded-xl border border-[#B85C38] bg-white px-3 py-2 text-xs font-semibold text-[#A24E31] transition hover:bg-[#B85C38] hover:text-white focus:outline-none focus:ring-4 focus:ring-[#B85C38]/10"
              >
                {isQuickAddItemOpen ? "− Close protein" : "+ Protein"}
              </button>
            </label>
          </div>
        </div>

        <div className={intakeSectionClassName}>
          <div>
            <p className="text-xs font-semibold text-[#2D2219]">Receipt information</p>
            <p className="mt-1 text-xs leading-5 text-[#6B7280]">Record the delivery and inspection details from the receipt.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className="flex items-center justify-between gap-3">
                <span className={intakeLabelClassName}>Batch number</span>
                <span className="rounded-full border border-[#D8DDE3] bg-[#F7F8F9] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#737B86]">Auto</span>
              </span>
              <input
                value={batchPreviewValue}
                readOnly
                disabled
                className="min-h-12 w-full rounded-2xl border border-[#D7DDE4] bg-[#F5F6F7] px-3 py-3 text-sm text-[#4B5563] opacity-100"
              />
              <p className="text-xs leading-5 text-[#6B7280]">
                Generated automatically when the receipt is saved using the protein code, delivery date, and Kampala time.
              </p>
            </label>

            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={intakeLabelClassName}>Date received</span>
              <input
                type="date"
                name="delivery_date"
                required
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
                className={intakeFieldClassName + " cursor-pointer pr-4 [&::-webkit-calendar-picker-indicator]:size-5 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70"}
              />
            </label>

            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={intakeLabelClassName}>Butchered date</span>
              <input
                type="date"
                name="butchered_on"
                required
                defaultValue={defaultDeliveryDate}
                className={intakeFieldClassName + " cursor-pointer pr-4 [&::-webkit-calendar-picker-indicator]:size-5 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70"}
              />
            </label>

            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={intakeLabelClassName}>Abattoir name</span>
              <input
                name="abattoir_name"
                required
                value={abattoirName}
                onChange={(event) => setAbattoirName(event.target.value)}
                placeholder="Processing or slaughter location"
                className={intakeFieldClassName}
              />
            </label>

            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={intakeLabelClassName}>Vet stamp number</span>
              <input
                name="vet_stamp_number"
                required
                placeholder="Inspection stamp reference"
                className={intakeFieldClassName}
              />
            </label>

            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={intakeLabelClassName}>Inspection officer</span>
              <input
                name="inspection_officer_name"
                required
                placeholder="Officer who signed off the meat"
                className={intakeFieldClassName}
              />
            </label>
          </div>
        </div>

        <div className={intakeSectionClassName}>
          <div>
            <p className="text-xs font-semibold text-[#2D2219]">Quantity & cost</p>
            <p className="mt-1 text-xs leading-5 text-[#6B7280]">Enter the amount received, its unit, and the purchase cost if available.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={intakeLabelClassName + " text-[#4B515A]"}>Quantity received</span>
              <input
                type="number"
                min="0"
                step={selectedProteinItem?.processingMode === "whole_bird" ? "1" : "0.01"}
                name="quantity_received"
                required
                value={quantityReceived}
                onChange={(event) => setQuantityReceived(event.target.value)}
                className={intakeFieldClassName + " min-h-[52px] border-[#BBC4CE] font-medium"}
              />
            </label>

            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={intakeLabelClassName + " text-[#4B515A]"}>Unit label</span>
              <input
                name="unit_name"
                required
                value={unitName}
                onChange={(event) => setUnitName(event.target.value)}
                className={intakeFieldClassName + " border-[#BBC4CE] font-medium"}
              />
            </label>

            <label className="grid gap-2 text-sm text-[#6B7280] lg:col-span-2">
              <span className={intakeLabelClassName + " text-[#4B515A]"}>Unit cost</span>
              <UgxAmountInput
                allowDecimals
                min="0"
                step="0.01"
                name="unit_cost"
                placeholder="Optional"
                className={intakeFieldClassName + " border-[#BBC4CE]"}
              />
            </label>
          </div>
        </div>

        <div className={intakeSectionClassName}>
          <label className="grid gap-2 text-sm text-[#6B7280]">
            <span className={intakeLabelClassName}>Notes</span>
            <textarea
              name="note"
              rows={4}
              placeholder={`Receiving notes for this ${(selectedProteinItem?.name ?? "protein").toLowerCase()} batch`}
              className={intakeFieldClassName + " min-h-28 resize-y"}
            />
          </label>
        </div>

        {selectedSupplier ? (
          <div className="grid gap-3 border-t border-[#E8E2DB] pt-6 md:grid-cols-3">
            <div className="md:col-span-3">
              <p className="text-xs font-semibold text-[#2D2219]">Supplier summary</p>
              <p className="mt-1 text-xs leading-5 text-[#6B7280]">Review the saved supplier details before recording the intake.</p>
            </div>
            <article className="rounded-[22px] border border-[#E5E1DC] bg-[#FAFAF9] px-4 py-4">
              <div className="flex items-center gap-3">
                <SupplierSummaryIcon type="supplier" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#707782]">Supplier details</p>
              </div>
              <p className="mt-2 text-base font-semibold text-[#111418]">{selectedSupplier.name}</p>
              <p className="mt-1 text-sm leading-6 text-[#6B7280]">{formatSupplierType(selectedSupplier.supplierType)}</p>
            </article>
            <article className="rounded-[22px] border border-[#E5E1DC] bg-[#FAFAF9] px-4 py-4">
              <div className="flex items-center gap-3">
                <SupplierSummaryIcon type="contact" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#707782]">Phone / license</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#6B7280]">{selectedSupplier.phoneNumber ?? "No phone recorded"}</p>
              <p className="mt-1 text-sm leading-6 text-[#6B7280]">{selectedSupplier.licenseNumber ?? "No license recorded"}</p>
            </article>
            <article className="rounded-[22px] border border-[#E5E1DC] bg-[#FAFAF9] px-4 py-4">
              <div className="flex items-center gap-3">
                <SupplierSummaryIcon type="abattoir" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#707782]">Default abattoir</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                {selectedSupplier.defaultAbattoirName ?? "No default abattoir saved yet"}
              </p>
            </article>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-[#E8E2DB] pt-6">
          <button
            type="submit"
            disabled={supplierOptions.length === 0 || proteinItemOptions.length === 0}
            className="min-h-12 rounded-2xl bg-[#111418] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2D2219] hover:shadow-md focus:outline-none focus:ring-4 focus:ring-[#111418]/10 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Record protein intake
          </button>
          <Link href="/suppliers" className="inline-flex min-h-12 items-center rounded-2xl border border-[#C9D0D8] bg-white px-5 py-3 text-sm font-semibold text-[#374151] transition hover:border-[#AEB8C3] hover:bg-[#F8FAFB] focus:outline-none focus:ring-4 focus:ring-[#111418]/5">
            Manage suppliers
          </Link>
        </div>
        {supplierOptions.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-[#6B7280]">
            Supplier traceability is required before a meat receipt can be recorded. Use quick add above or open the suppliers page.
          </p>
        ) : null}
        {proteinItemOptions.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-[#6B7280]">
            Add a protein item and map its sellable portion before recording this receipt.
          </p>
        ) : null}
        <input type="hidden" name="allocated_to_halves" value="0" />
        <input type="hidden" name="allocated_to_quarters" value="0" />
      </form>
    </section>
  );
}
