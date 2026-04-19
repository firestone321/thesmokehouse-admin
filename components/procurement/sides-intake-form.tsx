"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  createInventoryItemInlineAction,
  createSupplierInlineAction,
  recordIngredientProcurementAction
} from "@/lib/ops/actions";
import { ProcurementInventoryOption, ProcurementSupplierOption } from "@/lib/ops/types";

function formatQuantity(value: number, unitName: string) {
  return `${value.toFixed(2)} ${unitName}`;
}

export function SidesIntakeForm({
  defaultDeliveryDate,
  inventoryItems,
  suppliers = []
}: {
  defaultDeliveryDate: string;
  inventoryItems: ProcurementInventoryOption[];
  suppliers?: ProcurementSupplierOption[];
}) {
  const ingredientItems = useMemo(
    () => inventoryItems.filter((item) => item.itemType === "ingredient"),
    [inventoryItems]
  );
  const [itemOptions, setItemOptions] = useState(ingredientItems);
  const [selectedItemId, setSelectedItemId] = useState<string>(ingredientItems[0] ? String(ingredientItems[0].id) : "");
  const [supplierOptions, setSupplierOptions] = useState(suppliers);
  const [supplierId, setSupplierId] = useState<string>(suppliers[0] ? String(suppliers[0].id) : "");
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(suppliers.length === 0);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [quickAddSuccess, setQuickAddSuccess] = useState<string | null>(null);
  const [isCreatingSupplier, startCreateSupplierTransition] = useTransition();
  const [isQuickAddItemOpen, setIsQuickAddItemOpen] = useState(ingredientItems.length === 0);
  const [quickAddItemError, setQuickAddItemError] = useState<string | null>(null);
  const [quickAddItemSuccess, setQuickAddItemSuccess] = useState<string | null>(null);
  const [isCreatingItem, startCreateItemTransition] = useTransition();

  const selectedItem = useMemo(
    () => itemOptions.find((item) => String(item.id) === selectedItemId) ?? null,
    [itemOptions, selectedItemId]
  );
  const selectedSupplier = useMemo(
    () => supplierOptions.find((supplier) => String(supplier.id) === supplierId) ?? null,
    [supplierId, supplierOptions]
  );

  useEffect(() => {
    setItemOptions(ingredientItems);
    setSelectedItemId((currentItemId) => currentItemId || (ingredientItems[0] ? String(ingredientItems[0].id) : ""));
  }, [ingredientItems]);

  useEffect(() => {
    setSupplierOptions(suppliers);
    setSupplierId((currentSupplierId) => currentSupplierId || (suppliers[0] ? String(suppliers[0].id) : ""));
  }, [suppliers]);

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
        setQuickAddSuccess(`${result.supplier.name} is ready to use for this sides intake.`);
        setIsQuickAddOpen(false);
        form.reset();
      } catch (error) {
        setQuickAddError(error instanceof Error ? error.message : "Unable to create supplier.");
      }
    });
  }

  async function handleQuickAddItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuickAddItemError(null);
    setQuickAddItemSuccess(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    startCreateItemTransition(async () => {
      try {
        const result = await createInventoryItemInlineAction(formData);

        if (!result.ok) {
          setQuickAddItemError("Unable to create tracked side item.");
          return;
        }

        setItemOptions((currentItems) => {
          const nextItems = currentItems.filter((item) => item.id !== result.item.id);
          nextItems.push(result.item);
          nextItems.sort((left, right) => left.name.localeCompare(right.name));
          return nextItems;
        });

        setSelectedItemId(String(result.item.id));
        setQuickAddItemSuccess(`${result.item.name} is ready to use for this sides intake.`);
        setIsQuickAddItemOpen(false);
        form.reset();
      } catch (error) {
        setQuickAddItemError(error instanceof Error ? error.message : "Unable to create tracked side item.");
      }
    });
  }

  return (
    <section className="surface-card rounded-[32px] p-5">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        onClick={() => setIsCollapsed((currentValue) => !currentValue)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsCollapsed((currentValue) => !currentValue);
          }
        }}
        className="cursor-pointer border-b border-[#EEF2F6] pb-4 outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#111418]/20"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Sides Intake</p>
            <h2 className="mt-2 text-xl font-semibold">Receive fries, gonja, and other side inputs</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Use this for side ingredients that arrive as tracked food inputs, currently received by weight in kilograms.
            </p>
          </div>
          <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#4B5563]">
            {isCollapsed ? "collapsed" : "open"}
          </span>
        </div>
        <p className="mt-3 text-sm text-[#6B7280]">{isCollapsed ? "Click this card to expand." : "Click this card to collapse."}</p>
      </div>

      {!isCollapsed ? (
        <>
          <form action={recordIngredientProcurementAction} className="mt-4 space-y-4">
            <div className="grid gap-3">
          {isQuickAddOpen ? (
            <div className="rounded-[24px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Add Supplier</p>
                  <h3 className="mt-2 text-lg font-semibold text-[#111418]">Quick add a sides supplier</h3>
                </div>
                <Link href="/suppliers" className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2 text-sm font-semibold text-[#111418]">
                  Open suppliers page
                </Link>
              </div>

              <div className="mt-4 grid gap-3">
                <input
                  form="sides-quick-add-supplier-form"
                  name="name"
                  required
                  placeholder="Supplier name"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <input
                  form="sides-quick-add-supplier-form"
                  name="phone_number"
                  placeholder="Phone number"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <input
                  form="sides-quick-add-supplier-form"
                  name="license_number"
                  placeholder="License number"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <textarea
                  form="sides-quick-add-supplier-form"
                  name="notes"
                  rows={3}
                  placeholder="Supplier notes or receiving context"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-sm text-[#111418]"
                />
                <input form="sides-quick-add-supplier-form" type="hidden" name="supplier_type" value="ingredient" />
                <label className="flex items-center gap-2 text-sm text-[#6B7280]">
                  <input form="sides-quick-add-supplier-form" type="checkbox" name="is_active" defaultChecked />
                  Active supplier
                </label>
                {quickAddError ? (
                  <div className="rounded-[20px] border border-[#F4C7C7] bg-[#FFF8F8] px-4 py-3 text-sm leading-6 text-[#8A1C1C]">
                    {quickAddError}
                  </div>
                ) : null}
                {quickAddSuccess ? (
                  <div className="rounded-[20px] border border-[#CFE8D6] bg-[#F2FBF5] px-4 py-3 text-sm leading-6 text-[#166534]">
                    {quickAddSuccess}
                  </div>
                ) : null}
                <button
                  form="sides-quick-add-supplier-form"
                  type="submit"
                  disabled={isCreatingSupplier}
                  className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingSupplier ? "Creating supplier..." : "Create supplier and use it"}
                </button>
              </div>
            </div>
          ) : null}

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
              {isQuickAddOpen ? "Close add supplier" : "Add supplier"}
            </button>
          </label>

          {isQuickAddItemOpen ? (
            <div className="rounded-[24px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Add Tracked Item</p>
                <h3 className="mt-2 text-lg font-semibold text-[#111418]">Quick add a side input item</h3>
              </div>

              <div className="mt-4 grid gap-3">
                <input
                  form="sides-quick-add-item-form"
                  name="name"
                  required
                  placeholder="Item name, e.g. fries input"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <input
                  form="sides-quick-add-item-form"
                  name="code"
                  placeholder="Code, e.g. fries_kg"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <input
                  form="sides-quick-add-item-form"
                  name="unit_name"
                  required
                  defaultValue="kg"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <input
                  form="sides-quick-add-item-form"
                  type="number"
                  step="0.01"
                  min="0"
                  name="reorder_threshold"
                  defaultValue="0"
                  placeholder="Reorder threshold"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <input form="sides-quick-add-item-form" type="hidden" name="item_type" value="ingredient" />
                {quickAddItemError ? (
                  <div className="rounded-[20px] border border-[#F4C7C7] bg-[#FFF8F8] px-4 py-3 text-sm leading-6 text-[#8A1C1C]">
                    {quickAddItemError}
                  </div>
                ) : null}
                {quickAddItemSuccess ? (
                  <div className="rounded-[20px] border border-[#CFE8D6] bg-[#F2FBF5] px-4 py-3 text-sm leading-6 text-[#166534]">
                    {quickAddItemSuccess}
                  </div>
                ) : null}
                <button
                  form="sides-quick-add-item-form"
                  type="submit"
                  disabled={isCreatingItem}
                  className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingItem ? "Creating tracked item..." : "Create tracked item and use it"}
                </button>
              </div>
            </div>
          ) : null}

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Tracked side item</span>
            <select
              name="inventory_item_id"
              value={selectedItemId}
              onChange={(event) => setSelectedItemId(event.target.value)}
              disabled={itemOptions.length === 0}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            >
              {itemOptions.length === 0 ? <option value="">Create a tracked item first</option> : null}
              {itemOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setIsQuickAddItemOpen((currentValue) => !currentValue);
                setQuickAddItemError(null);
                setQuickAddItemSuccess(null);
              }}
              className="text-left text-xs font-semibold text-[#111418] underline underline-offset-4"
            >
              {isQuickAddItemOpen ? "Close add tracked item" : "Add tracked item"}
            </button>
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

        {selectedSupplier ? (
          <article className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Selected supplier</p>
            <p className="mt-2 text-base font-semibold text-[#111418]">{selectedSupplier.name}</p>
            <p className="mt-1 text-sm leading-6 text-[#6B7280]">
              {selectedSupplier.phoneNumber ?? "No phone recorded"}
              {selectedSupplier.licenseNumber ? ` | ${selectedSupplier.licenseNumber}` : ""}
            </p>
          </article>
        ) : null}

        <label className="space-y-2 text-sm text-[#6B7280]">
          <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Notes</span>
          <textarea
            name="note"
            rows={3}
            placeholder="Receiving remarks for this sides intake"
            className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-[#111418]"
          />
        </label>

        <button
          type="submit"
          disabled={supplierOptions.length === 0 || itemOptions.length === 0}
          className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          Save sides intake
        </button>
        {supplierOptions.length === 0 ? (
          <p className="text-sm leading-6 text-[#6B7280]">
            Add a supplier first so this sides intake is recorded against a saved supplier.
          </p>
        ) : null}
        {itemOptions.length === 0 ? (
          <p className="text-sm leading-6 text-[#6B7280]">
            Add a tracked side item first so this intake can be recorded into inventory.
          </p>
        ) : null}
          </form>
          <form id="sides-quick-add-supplier-form" onSubmit={handleQuickAddSupplier}></form>
          <form id="sides-quick-add-item-form" onSubmit={handleQuickAddItem}></form>
        </>
      ) : (
        <div className="mt-4 rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
          Expand this card when you need to receive fries, gonja, or other tracked side inputs.
        </div>
      )}
    </section>
  );
}
