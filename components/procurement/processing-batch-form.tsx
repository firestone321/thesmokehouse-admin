"use client";

import { useEffect, useMemo, useState } from "react";
import { processProcurementReceiptToFinishedStockAction } from "@/lib/ops/actions";
import { ProcurementActivityRecord, ProcurementPortionOption } from "@/lib/ops/types";
import { getAllowedPortionCodesForReceipt, getExpectedYieldEstimate } from "@/lib/ops/yield";

function formatPortionLabel(option: ProcurementPortionOption) {
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

export function ProcessingBatchForm({
  portionOptions,
  proteinReceipts
}: {
  portionOptions: ProcurementPortionOption[];
  proteinReceipts: ProcurementActivityRecord[];
}) {
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>(
    proteinReceipts.find((receipt) => !receipt.hasProcessingBatch)
      ? String(proteinReceipts.find((receipt) => !receipt.hasProcessingBatch)?.id)
      : ""
  );
  const [selectedPortionId, setSelectedPortionId] = useState<string>("");
  const [postRoastPackedWeightKg, setPostRoastPackedWeightKg] = useState<string>("");
  const [quantityProduced, setQuantityProduced] = useState<string>("");
  const [birdsAllocatedToHalves, setBirdsAllocatedToHalves] = useState<string>("0");
  const [birdsAllocatedToQuarters, setBirdsAllocatedToQuarters] = useState<string>("0");

  const selectedReceipt = useMemo(
    () => proteinReceipts.find((receipt) => String(receipt.id) === selectedReceiptId) ?? null,
    [proteinReceipts, selectedReceiptId]
  );
  const hasActionableReceipt = proteinReceipts.some((receipt) => !receipt.hasProcessingBatch);
  const isWholeChicken = selectedReceipt?.proteinCode === "whole_chicken";
  const totalBirds = selectedReceipt && isWholeChicken ? selectedReceipt.quantityReceived : 0;
  const wholeChickenCountIsValid = !isWholeChicken || (Number.isInteger(totalBirds) && totalBirds > 0);

  const filteredPortionOptions = useMemo(() => {
    if (!selectedReceipt?.proteinCode) {
      return [];
    }

    const allowedPortionCodes = new Set(getAllowedPortionCodesForReceipt(selectedReceipt.proteinCode));
    return portionOptions.filter((option) => allowedPortionCodes.has(option.code));
  }, [portionOptions, selectedReceipt]);

  useEffect(() => {
    if (!filteredPortionOptions.find((option) => String(option.id) === selectedPortionId)) {
      setSelectedPortionId(filteredPortionOptions[0] ? String(filteredPortionOptions[0].id) : "");
    }
  }, [filteredPortionOptions, selectedPortionId]);

  const selectedPortion = filteredPortionOptions.find((option) => String(option.id) === selectedPortionId) ?? null;
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
    if (selectedReceipt?.proteinCode === "whole_chicken") {
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
    if (isWholeChicken) {
      setQuantityProduced("");
      return;
    }

    if (expectedPortionsFromPackedWeight !== null) {
      setQuantityProduced(String(expectedPortionsFromPackedWeight));
      return;
    }

    setQuantityProduced(expectedYield ? String(expectedYield.quantity) : "");
  }, [expectedPortionsFromPackedWeight, expectedYield, isWholeChicken, selectedReceiptId, selectedPortionId]);

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
        <form action={processProcurementReceiptToFinishedStockAction} className="mt-4 space-y-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="space-y-2 text-sm text-[#6B7280]">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Protein receipt</span>
              <select
                name="procurement_receipt_id"
                value={selectedReceiptId}
                onChange={(event) => setSelectedReceiptId(event.target.value)}
                className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
              >
                {proteinReceipts.map((receipt) => (
                  <option key={receipt.id} value={receipt.id} disabled={receipt.hasProcessingBatch}>
                    {formatReceiptOptionLabel(receipt)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-[#6B7280]">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">
                {isWholeChicken ? "Whole birds received" : "Raw receipt weight"}
              </span>
              <input
                value={
                  selectedReceipt
                    ? `${selectedReceipt.quantityReceived.toFixed(isWholeChicken ? 0 : 2)} ${selectedReceipt.unitName}`
                    : ""
                }
                readOnly
                className="w-full rounded-2xl border border-[#D7DDE4] bg-[#F8FAFB] px-3 py-2.5 text-[#111418]"
              />
            </label>

            {isWholeChicken ? (
              <div className="grid gap-3 md:grid-cols-2 lg:col-span-2">
                <label className="space-y-2 text-sm text-[#6B7280]">
                  <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Birds allocated to halves</span>
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
                    className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                  />
                </label>

                <label className="space-y-2 text-sm text-[#6B7280]">
                  <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Birds allocated to quarters</span>
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
                    className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                  />
                </label>
              </div>
            ) : (
              <>
                <label className="space-y-2 text-sm text-[#6B7280]">
                  <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Finished product</span>
                  <select
                    name="portion_type_id"
                    value={selectedPortionId}
                    onChange={(event) => setSelectedPortionId(event.target.value)}
                    className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                  >
                    {filteredPortionOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {formatPortionLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2 text-sm text-[#6B7280]">
                  <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Post-roast packed weight (kg)</span>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    name="post_roast_packed_weight_kg"
                    disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch}
                    value={postRoastPackedWeightKg}
                    onChange={(event) => setPostRoastPackedWeightKg(event.target.value)}
                    placeholder="Packed weight after roasting and vacuum sealing"
                    className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                  />
                </label>

                <label className="space-y-2 text-sm text-[#6B7280]">
                  <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Quantity produced</span>
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
                    className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
                  />
                </label>
              </>
            )}
          </div>

          {selectedReceipt ? (
            <div className="grid gap-3 md:grid-cols-2">
              <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Raw receipt</p>
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
              <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Processing guidance</p>
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
                ) : expectedPortionsFromPackedWeight !== null && portionSizeKg ? (
                  <>
                    <p className="mt-2 text-xl font-semibold text-[#111418]">{expectedPortionsFromPackedWeight} expected portions</p>
                    <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                      Calculated as floor({postRoastPackedWeightKg || "0"} kg / {portionSizeKg.toFixed(3)} kg per portion).
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                      The quantity field is prefilled from the packed weight and can still be edited to match the real packed output.
                    </p>
                  </>
                ) : expectedYield ? (
                  <>
                    <p className="mt-2 text-xl font-semibold text-[#111418]">{expectedYield.quantity} expected portions</p>
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
                {selectedReceipt.proteinCode === "whole_chicken" ? (
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

          {isWholeChicken ? (
            <input type="hidden" name="quantity_produced" value="" />
          ) : null}

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Note</span>
            <textarea
              name="note"
              rows={3}
              disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch}
              placeholder="Batch note, freezer note, or processing remark"
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-[#111418]"
            />
          </label>

          <button
            type="submit"
            disabled={!selectedReceipt || selectedReceipt.hasProcessingBatch || (isWholeChicken && !wholeChickenCountIsValid)}
            className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add to finished stock
          </button>
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
