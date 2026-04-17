"use client";

import { useMemo, useState } from "react";
import { recordSupplyProcurementAction } from "@/lib/ops/actions";
import { ProcurementInventoryOption } from "@/lib/ops/types";

function formatQuantity(value: number, unitName: string) {
  return `${value.toFixed(2)} ${unitName}`;
}

export function SupplyIntakeForm({
  defaultDeliveryDate,
  inventoryItems,
  defaultInventoryItemId
}: {
  defaultDeliveryDate: string;
  inventoryItems: ProcurementInventoryOption[];
  defaultInventoryItemId?: number | null;
}) {
  const [selectedItemId, setSelectedItemId] = useState<string>(
    defaultInventoryItemId ? String(defaultInventoryItemId) : inventoryItems[0] ? String(inventoryItems[0].id) : ""
  );

  const selectedItem = useMemo(
    () => inventoryItems.find((item) => String(item.id) === selectedItemId) ?? null,
    [inventoryItems, selectedItemId]
  );

  return (
    <section className="surface-card rounded-[32px] p-5">
      <div className="border-b border-[#EEF2F6] pb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Supply Resupply</p>
        <h2 className="mt-2 text-xl font-semibold">Receive packaging and tracked supplies</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
          Use this when stock physically arrives. Saving here also adds the quantity into tracked inventory.
        </p>
      </div>

      {inventoryItems.length > 0 ? (
        <form action={recordSupplyProcurementAction} className="mt-4 space-y-4">
          <div className="grid gap-3">
            <label className="space-y-2 text-sm text-[#6B7280]">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Tracked supply item</span>
              <select
                name="inventory_item_id"
                value={selectedItemId}
                onChange={(event) => setSelectedItemId(event.target.value)}
                className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
              >
                {inventoryItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-[#6B7280]">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Supplier</span>
              <input
                name="supplier_name"
                required
                placeholder="Supplier or receiving note"
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
              <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">
                Quantity received{selectedItem ? ` (${selectedItem.unitName})` : ""}
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                name="quantity_received"
                required
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
          </div>

          {selectedItem ? (
            <div className="grid gap-3 md:grid-cols-2">
              <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Current on hand</p>
                <p className="mt-2 text-xl font-semibold text-[#111418]">
                  {formatQuantity(selectedItem.currentQuantity, selectedItem.unitName)}
                </p>
              </article>
              <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Reorder threshold</p>
                <p className="mt-2 text-xl font-semibold text-[#111418]">
                  {formatQuantity(selectedItem.reorderThreshold, selectedItem.unitName)}
                </p>
              </article>
            </div>
          ) : null}

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Notes</span>
            <textarea
              name="note"
              rows={3}
              placeholder="Batch, carton count, receiving remarks"
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-[#111418]"
            />
          </label>

          <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
            Save resupply
          </button>
        </form>
      ) : (
        <div className="mt-4 rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
          No tracked supply items are available yet. Add or activate supply items in inventory before using this form.
        </div>
      )}
    </section>
  );
}
