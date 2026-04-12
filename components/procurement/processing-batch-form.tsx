"use client";

import { useEffect, useMemo, useState } from "react";
import { processProcurementReceiptToFinishedStockAction } from "@/lib/ops/actions";
import { ProcurementActivityRecord, ProcurementPortionOption } from "@/lib/ops/types";
import { getAllowedPortionCodesForReceipt, getExpectedYieldEstimate } from "@/lib/ops/yield";

function formatPortionLabel(option: ProcurementPortionOption) {
  return option.portionLabel ? `${option.name} (${option.portionLabel})` : option.name;
}

export function ProcessingBatchForm({
  portionOptions,
  proteinReceipts
}: {
  portionOptions: ProcurementPortionOption[];
  proteinReceipts: ProcurementActivityRecord[];
}) {
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>(proteinReceipts[0] ? String(proteinReceipts[0].id) : "");
  const [selectedPortionId, setSelectedPortionId] = useState<string>("");
  const [quantityProduced, setQuantityProduced] = useState<string>("");

  const selectedReceipt = useMemo(
    () => proteinReceipts.find((receipt) => String(receipt.id) === selectedReceiptId) ?? null,
    [proteinReceipts, selectedReceiptId]
  );

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

  useEffect(() => {
    setQuantityProduced(expectedYield ? String(expectedYield.quantity) : "");
  }, [expectedYield, selectedReceiptId, selectedPortionId]);

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
                  <option key={receipt.id} value={receipt.id}>
                    {receipt.itemName} | {receipt.supplierName} | {receipt.deliveryDate}
                  </option>
                ))}
              </select>
            </label>

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
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Quantity produced</span>
              <input
                type="number"
                min="1"
                step="1"
                name="quantity_produced"
                required
                value={quantityProduced}
                onChange={(event) => setQuantityProduced(event.target.value)}
                placeholder="Finished portions added to frozen stock"
                className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
              />
            </label>
          </div>

          {selectedReceipt ? (
            <div className="grid gap-3 md:grid-cols-2">
              <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Raw receipt</p>
                <p className="mt-2 text-xl font-semibold text-[#111418]">
                  {selectedReceipt.quantityReceived.toFixed(2)} {selectedReceipt.unitName}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#6B7280]">{selectedReceipt.supplierName}</p>
              </article>
              <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Processing guidance</p>
                {expectedYield ? (
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
                      Enter the real finished portions that came out of processing. Automatic estimates only appear when
                      the selected receipt and portion size make the math clear.
                    </p>
                  </>
                )}
                {selectedReceipt.proteinCode === "whole_chicken" ? (
                  <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                    Already processed from this receipt: {selectedReceipt.processedHalves} halves and {selectedReceipt.processedQuarters} quarters.
                  </p>
                ) : null}
              </article>
            </div>
          ) : null}

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Note</span>
            <textarea
              name="note"
              rows={3}
              placeholder="Batch note, freezer note, or processing remark"
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-[#111418]"
            />
          </label>

          <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
            Add to finished stock
          </button>
        </form>
      ) : (
        <div className="mt-4 rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
          No protein receipts are available yet. Record raw meat intake first, then convert it into finished stock after
          processing.
        </div>
      )}
    </section>
  );
}
