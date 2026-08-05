"use client";

import { useEffect, useMemo, useState } from "react";
import { processProcurementReceiptToFinishedStockAction } from "@/lib/ops/actions";
import { ProcurementActivityRecord, ProcurementPortionOption, ProteinIntakeItemOption } from "@/lib/ops/types";
import { getExpectedYieldEstimate } from "@/lib/ops/yield";

function formatPortionLabel(option: Pick<ProcurementPortionOption, "name" | "portionLabel">) {
  return option.portionLabel ? `${option.name} (${option.portionLabel})` : option.name;
}

function formatRemainingQuantity(quantity: number | null, unitName: string) {
  if (quantity === null) {
    return "Unknown";
  }

  const normalizedUnit = unitName.trim().toLowerCase();
  const decimals = normalizedUnit === "bird" || normalizedUnit === "birds" ? 0 : 2;
  const formatted = quantity.toFixed(decimals).replace(/\.?0+$/, "");
  return `${formatted} ${unitName}`;
}

function formatReceiptOptionLabel(receipt: ProcurementActivityRecord) {
  const primaryLabel = receipt.batchNumber ?? receipt.itemName;
  if (receipt.hasProcessingBatch) {
    return `${primaryLabel} | Processed batch closed`;
  }
  const remaining = formatRemainingQuantity(receipt.remainingQuantity, receipt.unitName);
  return `${primaryLabel} | Remaining: ${remaining}`;
}

function parsePortionWeightKg(portionLabel: string | null | undefined) {
  if (!portionLabel) {
    return null;
  }

  const normalized = portionLabel.trim().toLowerCase();

  if (!normalized.endsWith("g")) {
    return null;
  }

  const numericValue = Number(normalized.slice(0, -1));
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue / 1000 : null;
}

const meatAllocatorPortionCodes = {
  beef_ribs: {
    standalone: "beef_ribs",
    countryPlatter: "country_platter_beef_ribs"
  },
  beef_oxtail: {
    standalone: "oxtail_portion",
    countryPlatter: "country_platter_oxtail"
  },
  goat_ribs: {
    standalone: "goat_rib_portions",
    countryPlatter: "country_platter_goat_ribs"
  },
  goat_chunks: {
    standalone: "goat_chunks_portions",
    countryPlatter: "country_platter_goat_chops"
  }
} as const;

function formatWeightKg(weight: number) {
  return `${weight.toFixed(3).replace(/\.?0+$/, "")} kg`;
}

const processingFieldClassName =
  "min-h-12 w-full rounded-2xl border border-[#CDD4DC] bg-[#FFFDF9] px-3 py-3 text-sm text-[#111418] shadow-sm transition hover:border-[#B85C38] hover:shadow-md focus:border-[#B85C38] focus:outline-none focus:ring-4 focus:ring-[#B85C38]/10";

const processingSelectClassName = processingFieldClassName + " cursor-pointer appearance-none pr-11";

const processingLabelClassName = "block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#707782]";

const processingSectionClassName = "grid gap-4 border-t border-[#E8E2DB] pt-6";

function ProcessingSelectChevron() {
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

function ProcessingSummaryIcon({ type }: { type: "receipt" | "guidance" }) {
  return (
    <span className="flex size-8 items-center justify-center rounded-xl border border-[#DED8D1] bg-white text-[#6B625B]" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-4">
        {type === "receipt" ? (
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6M9 16h3" />
        ) : (
          <path d="M9 18h6M10 22h4M8.5 14.5A7 7 0 1 1 15.5 14.5C14.5 15.3 14 16 14 18h-4c0-2-.5-2.7-1.5-3.5Z" />
        )}
      </svg>
    </span>
  );
}

export function ProcessingBatchForm({
  portionOptions,
  proteinIntakeItems,
  proteinReceipts
}: {
  portionOptions: ProcurementPortionOption[];
  proteinIntakeItems: ProteinIntakeItemOption[];
  proteinReceipts: ProcurementActivityRecord[];
}) {
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>(
    proteinReceipts.find((receipt) => !receipt.hasProcessingBatch)
      ? String(proteinReceipts.find((receipt) => !receipt.hasProcessingBatch)?.id)
      : ""
  );
  const [selectedPortionId, setSelectedPortionId] = useState<string>("");
  const [postRoastPackedWeightKg, setPostRoastPackedWeightKg] = useState<string>("");
  const [countryPlatterWeightKg, setCountryPlatterWeightKg] = useState<string>("0");
  const [quantityProduced, setQuantityProduced] = useState<string>("");
  const [birdsAllocatedToHalves, setBirdsAllocatedToHalves] = useState<string>("0");
  const [birdsAllocatedToQuarters, setBirdsAllocatedToQuarters] = useState<string>("0");

  const selectedReceipt = useMemo(
    () => proteinReceipts.find((receipt) => String(receipt.id) === selectedReceiptId) ?? null,
    [proteinReceipts, selectedReceiptId]
  );
  const hasActionableReceipt = proteinReceipts.some((receipt) => !receipt.hasProcessingBatch);
  const selectedProteinItem = useMemo(
    () => proteinIntakeItems.find((item) => item.id === selectedReceipt?.proteinIntakeItemId) ?? null,
    [proteinIntakeItems, selectedReceipt?.proteinIntakeItemId]
  );
  const isWholeChicken = selectedReceipt?.processingMode === "whole_bird";
  const meatAllocatorCodes = selectedReceipt?.proteinCode
    ? meatAllocatorPortionCodes[selectedReceipt.proteinCode as keyof typeof meatAllocatorPortionCodes] ?? null
    : null;
  const isMeatAllocator = Boolean(meatAllocatorCodes);
  const totalBirds = selectedReceipt && isWholeChicken ? selectedReceipt.quantityReceived : 0;
  const wholeChickenCountIsValid = !isWholeChicken || (Number.isInteger(totalBirds) && totalBirds > 0);

  const filteredPortionOptions = useMemo(() => {
    if (!selectedProteinItem) {
      return [];
    }

    const allowedPortionTypeIds = new Set(selectedProteinItem.portionTypeIds);
    return portionOptions.filter((option) => allowedPortionTypeIds.has(option.id));
  }, [portionOptions, selectedProteinItem]);

  useEffect(() => {
    if (!filteredPortionOptions.find((option) => String(option.id) === selectedPortionId)) {
      setSelectedPortionId(filteredPortionOptions[0] ? String(filteredPortionOptions[0].id) : "");
    }
  }, [filteredPortionOptions, selectedPortionId]);

  const selectedPortion = filteredPortionOptions.find((option) => String(option.id) === selectedPortionId) ?? null;
  const meatAllocatorStandalonePortion = meatAllocatorCodes
    ? filteredPortionOptions.find((option) => option.code === meatAllocatorCodes.standalone) ?? null
    : null;
  const meatAllocatorCountryPlatterPortion = meatAllocatorCodes
    ? filteredPortionOptions.find((option) => option.code === meatAllocatorCodes.countryPlatter) ?? null
    : null;
  const meatAllocation = useMemo(() => {
    const packedWeightKg = Number(postRoastPackedWeightKg);
    const countryPlatterWeight = Number(countryPlatterWeightKg);
    const standalonePortionWeightKg = parsePortionWeightKg(meatAllocatorStandalonePortion?.portionLabel);
    const countryPlatterPortionWeightKg = parsePortionWeightKg(meatAllocatorCountryPlatterPortion?.portionLabel);

    if (
      !Number.isFinite(packedWeightKg) ||
      packedWeightKg <= 0 ||
      !Number.isFinite(countryPlatterWeight) ||
      countryPlatterWeight < 0 ||
      countryPlatterWeight > packedWeightKg ||
      !standalonePortionWeightKg ||
      !countryPlatterPortionWeightKg
    ) {
      return null;
    }

    const countryPlatterQuantity = Math.floor(countryPlatterWeight / countryPlatterPortionWeightKg);
    const standaloneWeightKg = packedWeightKg - countryPlatterWeight;
    const standaloneQuantity = Math.floor(standaloneWeightKg / standalonePortionWeightKg);
    const trimWeightKg = Number(
      (
        packedWeightKg -
        countryPlatterQuantity * countryPlatterPortionWeightKg -
        standaloneQuantity * standalonePortionWeightKg
      ).toFixed(3)
    );

    return {
      countryPlatterQuantity,
      standaloneQuantity,
      standaloneWeightKg,
      trimWeightKg
    };
  }, [
    countryPlatterWeightKg,
    meatAllocatorCountryPlatterPortion?.portionLabel,
    meatAllocatorStandalonePortion?.portionLabel,
    postRoastPackedWeightKg
  ]);
  const portionSizeKg = useMemo(() => parsePortionWeightKg(selectedPortion?.portionLabel), [selectedPortion?.portionLabel]);
  const expectedYield = useMemo(
    () =>
      selectedReceipt?.proteinCode && selectedPortion
        ? getExpectedYieldEstimate({
          proteinCode: selectedReceipt.proteinCode,
          quantityReceived: selectedReceipt.quantityReceived,
          unitName: selectedReceipt.unitName,
          portion: selectedPortion
          })
        : null,
    [selectedPortion, selectedReceipt]
  );
  const expectedPortionsFromPackedWeight = useMemo(() => {
    const packedWeight = Number(postRoastPackedWeightKg);

    if (!Number.isFinite(packedWeight) || packedWeight <= 0 || !portionSizeKg) {
      return null;
    }

    return Math.floor(packedWeight / portionSizeKg);
  }, [portionSizeKg, postRoastPackedWeightKg]);

  const producedHalfCount = useMemo(() => {
    const birds = Number(birdsAllocatedToHalves);
    return Number.isFinite(birds) && birds >= 0 ? birds * 2 : 0;
  }, [birdsAllocatedToHalves]);

  const producedQuarterCount = useMemo(() => {
    const birds = Number(birdsAllocatedToQuarters);
    return Number.isFinite(birds) && birds >= 0 ? birds * 4 : 0;
  }, [birdsAllocatedToQuarters]);

  useEffect(() => {
    setPostRoastPackedWeightKg("");
    setCountryPlatterWeightKg("0");
    if (selectedReceipt?.processingMode === "whole_bird") {
      const initialBirds = wholeChickenCountIsValid ? String(totalBirds) : "0";
      setBirdsAllocatedToHalves(initialBirds);
      setBirdsAllocatedToQuarters("0");
      setQuantityProduced("");
      return;
    }
    setBirdsAllocatedToHalves("0");
    setBirdsAllocatedToQuarters("0");
  }, [selectedReceiptId]);

  useEffect(() => {
    if (isWholeChicken || isMeatAllocator) {
      setQuantityProduced("");
      return;
    }

    if (expectedPortionsFromPackedWeight !== null) {
      setQuantityProduced(String(expectedPortionsFromPackedWeight));
      return;
    }

    setQuantityProduced(expectedYield ? String(expectedYield.quantity) : "");
  }, [expectedPortionsFromPackedWeight, expectedYield, isMeatAllocator, isWholeChicken, selectedReceiptId, selectedPortionId]);

  function clampWholeChickenBirds(value: string) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed)) {
      return 0;
    }

    if (!wholeChickenCountIsValid) {
      return 0;
    }

    return Math.min(Math.max(parsed, 0), totalBirds);
  }

  function handleHalvesAllocationChange(value: string) {
    const nextHalves = clampWholeChickenBirds(value);
    setBirdsAllocatedToHalves(String(nextHalves));
    setBirdsAllocatedToQuarters(String(Math.max(totalBirds - nextHalves, 0)));
  }

  function handleQuartersAllocationChange(value: string) {
    const nextQuarters = clampWholeChickenBirds(value);
    setBirdsAllocatedToQuarters(String(nextQuarters));
    setBirdsAllocatedToHalves(String(Math.max(totalBirds - nextQuarters, 0)));
  }

  return (
    <section className="surface-card rounded-[32px] p-5">
      <div className="border-b border-[#EEF2F6] pb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Processing</p>
        <h2 className="mt-2 text-xl font-semibold">Convert received meat into finished frozen stock</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
          Use this after the meat has been processed, pre-roasted, and packed. The produced quantity becomes available as
          finished stock for future orders.
        </p>
      </div>

      {proteinReceipts.length > 0 ? (
        <form action={processProcurementReceiptToFinishedStockAction} className="mt-6 grid gap-7">
          <div className="grid gap-4">
            <div>
              <p className="text-xs font-semibold text-[#2D2219]">Protein receipt</p>
              <p className="mt-1 text-xs leading-5 text-[#6B7280]">Choose the raw delivery that is ready to be converted into finished stock.</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="grid gap-2 text-sm text-[#6B7280]">
                <span className={processingLabelClassName}>Protein receipt</span>
                <div className="group relative">
                  <select
                    name="procurement_receipt_id"
                    value={selectedReceiptId}
                    onChange={(event) => setSelectedReceiptId(event.target.value)}
                    className={processingSelectClassName}
                  >
                    {proteinReceipts.map((receipt) => (
                      <option key={receipt.id} value={receipt.id} disabled={receipt.hasProcessingBatch}>
                        {formatReceiptOptionLabel(receipt)}
                      </option>
                    ))}
                  </select>
                  <ProcessingSelectChevron />
                </div>
              </label>

              <label className="grid gap-2 text-sm text-[#6B7280]">
                <span className={processingLabelClassName}>
                  {isWholeChicken ? "Whole birds received" : "Raw receipt weight"}
                </span>
                <input
                  value={
                    selectedReceipt
                      ? `${selectedReceipt.quantityReceived.toFixed(isWholeChicken ? 0 : 2)} ${selectedReceipt.unitName}`
                      : ""
                  }
                  readOnly
                  className="min-h-12 w-full rounded-2xl border border-[#CDD4DC] bg-[#F5F6F7] px-3 py-3 text-sm font-medium text-[#4B5563] shadow-sm"
                />
              </label>
            </div>
          </div>

          {isWholeChicken ? (
            <div className={processingSectionClassName}>
              <div>
                <p className="text-xs font-semibold text-[#2D2219]">Production output</p>
                <p className="mt-1 text-xs leading-5 text-[#6B7280]">Allocate the received birds between finished halves and quarters.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-[#6B7280]">
                  <span className={processingLabelClassName}>Birds allocated to halves</span>
                  <input
                    type="number"
                    min="0"
                    max={wholeChickenCountIsValid ? totalBirds : undefined}
                    step="1"
                    name="birds_allocated_to_halves"
                    disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch || !wholeChickenCountIsValid}
                    value={birdsAllocatedToHalves}
                    onChange={(event) => handleHalvesAllocationChange(event.target.value)}
                    placeholder="Birds going to halves"
                    className={processingFieldClassName}
                  />
                </label>

                <label className="grid gap-2 text-sm text-[#6B7280]">
                  <span className={processingLabelClassName}>Birds allocated to quarters</span>
                  <input
                    type="number"
                    min="0"
                    max={wholeChickenCountIsValid ? totalBirds : undefined}
                    step="1"
                    name="birds_allocated_to_quarters"
                    disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch || !wholeChickenCountIsValid}
                    value={birdsAllocatedToQuarters}
                    onChange={(event) => handleQuartersAllocationChange(event.target.value)}
                    placeholder="Birds going to quarters"
                    className={processingFieldClassName}
                  />
                </label>
              </div>
            </div>
          ) : isMeatAllocator ? (
            <>
              <div className="grid gap-5 border-t border-[#E8E2DB] pt-6">
                <div className="rounded-[28px] border-2 border-[#D4A373] bg-[#FFF5E8] p-4 shadow-sm sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="inline-flex rounded-full bg-[#F2D4B3] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#70452C]">
                        Step 1 · Country Platter allocation
                      </p>
                      <h3 className="mt-3 text-lg font-semibold text-[#2D2219]">Set aside platter meat first</h3>
                      <p className="mt-1 max-w-xl text-sm leading-6 text-[#6B625B]">
                        Put the cooked meat for Country Platter packs aside before the remaining meat is packed for normal orders.
                      </p>
                    </div>
                    <span className="flex size-10 items-center justify-center rounded-2xl border border-[#D4A373] bg-[#FFFDF9] text-xl" aria-hidden="true">
                      📦
                    </span>
                  </div>

                  <label className="mt-5 grid gap-2 text-sm text-[#6B7280]">
                    <span className={processingLabelClassName + " text-[#70452C]"}>1. Total usable meat after roasting (kg)</span>
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      name="post_roast_packed_weight_kg"
                      required
                      disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch}
                      value={postRoastPackedWeightKg}
                      onChange={(event) => setPostRoastPackedWeightKg(event.target.value)}
                      placeholder="Usable cooked weight after roasting"
                      className={processingFieldClassName + " border-[#C89263] bg-[#FFFDF9] text-base font-semibold"}
                    />
                  </label>

                  <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
                    <label className="grid gap-2 rounded-[22px] border-2 border-[#B85C38] bg-[#FFFDF9] p-4 text-sm text-[#6B7280] shadow-sm">
                      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9B4B2F]">2. Country Platter</span>
                      <span className="text-base font-semibold text-[#2D2219]">Weight to set aside (kg)</span>
                      <input
                        type="number"
                        min="0"
                        max={postRoastPackedWeightKg || undefined}
                        step="0.001"
                        name="country_platter_weight_kg"
                        required
                        disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch}
                        value={countryPlatterWeightKg}
                        onChange={(event) => setCountryPlatterWeightKg(event.target.value)}
                        placeholder="For example: 5"
                        className={processingFieldClassName + " border-[#B85C38] bg-white text-xl font-bold text-[#2D2219]"}
                      />
                      <span className="text-xs leading-5 text-[#6B625B]">This meat is reserved for Country Platter packs.</span>
                    </label>

                    <div className="hidden items-center justify-center text-2xl font-semibold text-[#9B4B2F] lg:flex" aria-hidden="true">→</div>

                    <div className="grid gap-2 rounded-[22px] border border-[#D8C7B5] bg-[#FFFDF9]/70 p-4 text-sm text-[#6B7280]">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#76513E]">3. Standalone orders</p>
                      <p className="text-base font-semibold text-[#2D2219]">Weight left for usual packs</p>
                      <output className="flex min-h-12 items-center rounded-2xl border border-[#D8C7B5] bg-[#F5EEE5] px-3 py-3 text-xl font-bold text-[#4C372A]">
                        {meatAllocation ? formatWeightKg(meatAllocation.standaloneWeightKg) : "Enter total weight first"}
                      </output>
                      <p className="text-xs leading-5 text-[#6B625B]">This is filled automatically. No typing is needed here.</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[#E3C4A5] bg-[#FFFDF9] px-4 py-3 text-sm leading-6 text-[#4C372A]">
                    {meatAllocation ? (
                      <>
                        You are setting aside <strong>{countryPlatterWeightKg || "0"} kg</strong> for Country Platter and leaving <strong>{formatWeightKg(meatAllocation.standaloneWeightKg)}</strong> for standalone orders.
                      </>
                    ) : (
                      <>Enter the usable cooked weight, then decide how much to set aside for Country Platter.</>
                    )}
                  </div>
                </div>
              </div>

              <div className={processingSectionClassName}>
                <div>
                  <p className="text-xs font-semibold text-[#2D2219]">Production output</p>
                  <p className="mt-1 text-xs leading-5 text-[#6B7280]">
                    The Meat Allocator makes full packs only and shows any remainder to hold as trim.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <article className="rounded-[22px] border border-[#E5E1DC] bg-[#FAFAF9] px-4 py-4">
                    <p className={processingLabelClassName}>Country Platter packs</p>
                    <p className="mt-2 text-xl font-semibold text-[#111418]">
                      {meatAllocation?.countryPlatterQuantity ?? 0}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#6B7280]">
                      {formatPortionLabel(meatAllocatorCountryPlatterPortion ?? { name: "Country Platter portion", portionLabel: null })}
                    </p>
                  </article>
                  <article className="rounded-[22px] border border-[#E5E1DC] bg-[#FAFAF9] px-4 py-4">
                    <p className={processingLabelClassName}>Standalone packs</p>
                    <p className="mt-2 text-xl font-semibold text-[#111418]">
                      {meatAllocation?.standaloneQuantity ?? 0}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#6B7280]">
                      {formatPortionLabel(meatAllocatorStandalonePortion ?? { name: "Standalone portion", portionLabel: null })}
                    </p>
                  </article>
                  <article className="rounded-[22px] border border-[#E5E1DC] bg-[#FAFAF9] px-4 py-4">
                    <p className={processingLabelClassName}>Trim / hold</p>
                    <p className="mt-2 text-xl font-semibold text-[#111418]">
                      {meatAllocation ? formatWeightKg(meatAllocation.trimWeightKg) : "—"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#6B7280]">Recorded, but not added to sellable stock.</p>
                  </article>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={processingSectionClassName}>
                <div>
                  <p className="text-xs font-semibold text-[#2D2219]">Finished product</p>
                  <p className="mt-1 text-xs leading-5 text-[#6B7280]">Choose what you produced and enter its packed weight after roasting.</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="grid gap-2 text-sm text-[#6B7280]">
                    <span className={processingLabelClassName}>Finished product</span>
                    <div className="group relative">
                      <select
                        name="portion_type_id"
                        value={selectedPortionId}
                        onChange={(event) => setSelectedPortionId(event.target.value)}
                        className={processingSelectClassName}
                      >
                        {filteredPortionOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {formatPortionLabel(option)}
                          </option>
                        ))}
                      </select>
                      <ProcessingSelectChevron />
                    </div>
                  </label>

                  <label className="grid gap-2 text-sm text-[#6B7280]">
                    <span className={processingLabelClassName}>Post-roast packed weight (kg)</span>
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      name="post_roast_packed_weight_kg"
                      disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch}
                      value={postRoastPackedWeightKg}
                      onChange={(event) => setPostRoastPackedWeightKg(event.target.value)}
                      placeholder="Packed weight after roasting and vacuum sealing"
                      className={processingFieldClassName}
                    />
                  </label>
                </div>
              </div>

              <div className={processingSectionClassName}>
                <div>
                  <p className="text-xs font-semibold text-[#2D2219]">Production output</p>
                  <p className="mt-1 text-xs leading-5 text-[#6B7280]">Confirm how many finished portions will be added to frozen stock.</p>
                </div>
                <label className="grid gap-2 text-sm text-[#6B7280]">
                  <span className={processingLabelClassName + " text-[#4B515A]"}>Quantity produced</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    name="quantity_produced"
                    required
                    disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch}
                    value={quantityProduced}
                    onChange={(event) => setQuantityProduced(event.target.value)}
                    placeholder="Finished portions added to frozen stock"
                    className={processingFieldClassName + " min-h-[52px] border-[#BBC4CE] text-base font-medium"}
                  />
                </label>
              </div>
            </>
          )}

          {selectedReceipt ? (
            <div className="grid gap-3 border-t border-[#E8E2DB] pt-6 md:grid-cols-2">
              <div className="md:col-span-2">
                <p className="text-xs font-semibold text-[#2D2219]">Processing summary</p>
                <p className="mt-1 text-xs leading-5 text-[#6B7280]">Review the selected receipt and expected production result.</p>
              </div>
              <article className="rounded-[22px] border border-[#E5E1DC] bg-[#FAFAF9] px-4 py-5">
                <div className="flex items-center gap-3">
                  <ProcessingSummaryIcon type="receipt" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#707782]">Raw receipt</p>
                </div>
                <p className="mt-2 text-xl font-semibold text-[#111418]">
                  {selectedReceipt.quantityReceived.toFixed(2)} {selectedReceipt.unitName}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#6B7280]">{selectedReceipt.supplierName}</p>
                {selectedReceipt.batchNumber ? (
                  <p className="mt-1 text-sm leading-6 text-[#6B7280]">Batch {selectedReceipt.batchNumber}</p>
                ) : null}
                {selectedReceipt.abattoirName ? (
                  <p className="mt-1 text-sm leading-6 text-[#6B7280]">{selectedReceipt.abattoirName}</p>
                ) : null}
              </article>
              <article className="rounded-[22px] border border-[#E5E1DC] bg-[#FAFAF9] px-4 py-5">
                <div className="flex items-center gap-3">
                  <ProcessingSummaryIcon type="guidance" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#707782]">Processing guidance</p>
                </div>
                {isWholeChicken ? (
                  <>
                    <p className="mt-2 text-xl font-semibold text-[#111418]">Chicken split allocation</p>
                    <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                      Allocate every received bird to either halves or quarters. Changing one side automatically fills the
                      remainder on the other side so the full receipt is always accounted for in one processing event.
                    </p>
                    {wholeChickenCountIsValid ? (
                      <>
                        <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                          Produced output: {producedHalfCount} halves and {producedQuarterCount} quarters.
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                          Based on {birdsAllocatedToHalves || "0"} birds to halves and {birdsAllocatedToQuarters || "0"} birds
                          to quarters.
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                        This receipt does not currently have a clean whole-number bird count, so chicken allocation is blocked
                        until the receipt quantity is corrected.
                      </p>
                    )}
                  </>
                ) : isMeatAllocator ? (
                  <>
                    <p className="mt-2 text-xl font-semibold text-[#111418]">Meat split allocation</p>
                    {meatAllocation ? (
                      <>
                        <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                          {formatWeightKg(meatAllocation.standaloneWeightKg)} remains for standalone packs after the Country Platter allocation.
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                          Full packs are added to stock. {formatWeightKg(meatAllocation.trimWeightKg)} is recorded as trim / hold and is not sellable stock.
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                        Enter the usable cooked weight and the amount to set aside for Country Platter packs to see the split.
                      </p>
                    )}
                  </>
                ) : expectedPortionsFromPackedWeight !== null && portionSizeKg ? (
                  <>
                    <p className="mt-3 text-2xl font-bold tracking-[-0.02em] text-[#2D2219]">{expectedPortionsFromPackedWeight} expected portions</p>
                    <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                      Calculated as floor({postRoastPackedWeightKg || "0"} kg / {portionSizeKg.toFixed(3)} kg per portion).
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                      The quantity field is prefilled from the packed weight and can still be edited to match the real packed output.
                    </p>
                  </>
                ) : expectedYield ? (
                  <>
                    <p className="mt-3 text-2xl font-bold tracking-[-0.02em] text-[#2D2219]">{expectedYield.quantity} expected portions</p>
                    <p className="mt-2 text-sm leading-6 text-[#6B7280]">Calculated from {expectedYield.detail}.</p>
                    <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                      The quantity field is prefilled with this estimate, and staff can still edit it to match the real output.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-xl font-semibold text-[#111418]">Manual yield recording</p>
                    <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                      Enter the post-roast packed weight and the real finished portions that came out of processing.
                      Automatic estimates only appear when the selected receipt and portion size make the math clear.
                    </p>
                  </>
                )}
                {selectedReceipt.processingMode === "whole_bird" ? (
                  <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                    Already processed from this receipt: {selectedReceipt.processedHalves} halves and {selectedReceipt.processedQuarters} quarters.
                  </p>
                ) : null}
                {selectedReceipt.hasProcessingBatch ? (
                  <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                    This receipt already has a completed processing batch. Keep it for yield reference, but do not process it again.
                  </p>
                ) : null}
              </article>
            </div>
          ) : null}

          {isWholeChicken || isMeatAllocator ? (
            <input type="hidden" name="quantity_produced" value="" />
          ) : null}

          <div className={processingSectionClassName}>
            <label className="grid gap-2 text-sm text-[#6B7280]">
              <span className={processingLabelClassName}>Note</span>
              <textarea
                name="note"
                rows={4}
                disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch}
                placeholder="Batch note, freezer note, or processing remark"
                className={processingFieldClassName + " min-h-28 resize-y"}
              />
            </label>
          </div>

          <div className="border-t border-[#E8E2DB] pt-6">
            <button
              type="submit"
              disabled={
                !selectedReceipt ||
                selectedReceipt.hasProcessingBatch ||
                (isWholeChicken && !wholeChickenCountIsValid) ||
                (isMeatAllocator && (!meatAllocation || meatAllocation.countryPlatterQuantity + meatAllocation.standaloneQuantity <= 0))
              }
              className="min-h-12 rounded-2xl bg-[#111418] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2D2219] hover:shadow-md focus:outline-none focus:ring-4 focus:ring-[#111418]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isMeatAllocator ? "Allocate meat stock" : "Add to finished stock"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
          No protein receipts have been logged yet. Record raw meat intake first, then convert it into finished stock after
          processing.
        </div>
      )}
      {proteinReceipts.length > 0 && !hasActionableReceipt ? (
        <div className="mt-4 rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
          Every visible receipt already has a completed processing batch. Closed batches stay here briefly for confirmation,
          then drop out of the list automatically.
        </div>
      ) : null}
    </section>
  );
}
