"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { UgxAmountInput } from "@/components/ugx-amount-input";
import {
  createInventoryItemInlineAction,
  createSupplierInlineAction,
  recordIngredientProcurementAction
} from "@/lib/ops/actions";
import {
  NonDrinkSellablePortionOption,
  ProcurementInventoryOption,
  ProcurementSupplierOption
} from "@/lib/ops/types";

function formatQuantity(value: number, unitName: string) {
  return `${value.toFixed(2)} ${unitName}`;
}

export function SidesIntakeForm({
  defaultDeliveryDate,
  inventoryItems,
  sellablePortions,
  suppliers = []
}: {
  defaultDeliveryDate: string;
  inventoryItems: ProcurementInventoryOption[];
  sellablePortions: NonDrinkSellablePortionOption[];
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
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(suppliers.length === 0);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [quickAddSuccess, setQuickAddSuccess] = useState<string | null>(null);
  const [isCreatingSupplier, startCreateSupplierTransition] = useTransition();
  const [isQuickAddItemOpen, setIsQuickAddItemOpen] = useState(ingredientItems.length === 0);
  const [quickAddItemError, setQuickAddItemError] = useState<string | null>(null);
  const [quickAddItemSuccess, setQuickAddItemSuccess] = useState<string | null>(null);
  const [isCreatingItem, startCreateItemTransition] = useTransition();
  const [sellableOptions, setSellableOptions] = useState(sellablePortions);
  const [portionToLinkId, setPortionToLinkId] = useState("");
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

  const selectedItem = useMemo(
    () => itemOptions.find((item) => String(item.id) === selectedItemId) ?? null,
    [itemOptions, selectedItemId]
  );
  const portionToLink = useMemo(
    () => sellableOptions.find((option) => String(option.portionTypeId) === portionToLinkId) ?? null,
    [portionToLinkId, sellableOptions]
  );
  const mappedNonDrinkInventoryIds = useMemo(() => new Set(
    sellableOptions
      .map((option) => itemOptions.find((item) => item.directSellablePortionTypeId === option.portionTypeId)?.id)
      .filter((id): id is number => Boolean(id))
  ), [itemOptions, sellableOptions]);
  const receivesPieces = selectedItem?.unitName.toLowerCase() === "piece" || selectedItem?.unitName.toLowerCase() === "pieces";
  const selectedSupplier = useMemo(
    () => supplierOptions.find((supplier) => String(supplier.id) === supplierId) ?? null,
    [supplierId, supplierOptions]
  );
  const batchPreviewValue = selectedItem ? `${selectedItem.code.toUpperCase()}-${deliveryDate.replaceAll("-", "")}-${batchPreviewTime}` : "";

  useEffect(() => {
    setItemOptions(ingredientItems);
    setSelectedItemId((currentItemId) => currentItemId || (ingredientItems[0] ? String(ingredientItems[0].id) : ""));
  }, [ingredientItems]);

  useEffect(() => {
    setSupplierOptions(suppliers);
    setSupplierId((currentSupplierId) => currentSupplierId || (suppliers[0] ? String(suppliers[0].id) : ""));
  }, [suppliers]);

  useEffect(() => {
    setSellableOptions(sellablePortions);
  }, [sellablePortions]);

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
        setQuickAddSuccess(`${result.supplier.name} is ready to use for this sides and drinks intake.`);
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
          setQuickAddItemError("Unable to create tracked side or drink item.");
          return;
        }

        setItemOptions((currentItems) => {
          const nextItems = currentItems.filter((item) => item.id !== result.item.id);
          nextItems.push(result.item);
          nextItems.sort((left, right) => left.name.localeCompare(right.name));
          return nextItems;
        });

        setSelectedItemId(String(result.item.id));
        setQuickAddItemSuccess(`${result.item.name} is ready to use for this sides and drinks intake.`);
        setIsQuickAddItemOpen(false);
        form.reset();
      } catch (error) {
        setQuickAddItemError(error instanceof Error ? error.message : "Unable to create tracked side or drink item.");
      }
    });
  }

  function handleLinkPortion() {
    if (!portionToLink) return;

    setQuickAddItemError(null);
    setQuickAddItemSuccess(null);
    startCreateItemTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("name", portionToLink.menuItemName);
        formData.set("unit_name", "portions");
        formData.set("item_type", "ingredient");
        formData.set("reorder_threshold", "0");
        formData.set("direct_sellable_portion_type_id", String(portionToLink.portionTypeId));
        formData.set("source_menu_item_id", String(portionToLink.menuItemId));
        const result = await createInventoryItemInlineAction(formData);

        if (!result.ok) {
          setQuickAddItemError("Unable to link this portion.");
          return;
        }

        setItemOptions((currentItems) => [...currentItems.filter((item) => item.id !== result.item.id), result.item]);
        setSellableOptions((currentOptions) => currentOptions.map((option) => (
          option.portionTypeId === portionToLink.portionTypeId ? { ...option, isMapped: true } : option
        )));
        setSelectedItemId(String(result.item.id));
        setPortionToLinkId("");
        setQuickAddItemSuccess(`${portionToLink.menuItemName} is linked. You will not need to do this again.`);
      } catch (error) {
        setQuickAddItemError(error instanceof Error ? error.message : "Unable to link this portion.");
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
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Sides & Drinks Intake</p>
            <h2 className="mt-2 text-xl font-semibold">Receive fries, gonja, juice, yoghurt, and soda</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Use this for side and drink inputs. Drinks created from the Menu page appear here automatically and credit
              their sellable stock directly, while raw side ingredients stay on the tracked-input path.
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
                  <h3 className="mt-2 text-lg font-semibold text-[#111418]">Quick add a sides or drinks supplier</h3>
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
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Raw input</p>
                <h3 className="mt-2 text-lg font-semibold text-[#111418]">Add something that needs preparation</h3>
                <p className="mt-1 text-sm leading-6 text-[#6B7280]">Menu portions are added automatically when the menu item is created.</p>
              </div>

              <div className="mt-4 grid gap-3">
                <input
                  form="sides-quick-add-item-form"
                  name="name"
                  required
                  placeholder="What is the raw item called?"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <input
                  form="sides-quick-add-item-form"
                  name="unit_name"
                  required
                  placeholder="How is it counted? For example kg"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <input
                  form="sides-quick-add-item-form"
                  type="number"
                  step="0.01"
                  min="0"
                  name="reorder_threshold"
                  placeholder="Low-stock level (optional)"
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
                  {isCreatingItem ? "Adding raw input..." : "Add raw input"}
                </button>
              </div>
            </div>
          ) : null}

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Choose portion</span>
            <select
              value={portionToLinkId ? `portion:${portionToLinkId}` : selectedItemId ? `item:${selectedItemId}` : ""}
              onChange={(event) => {
                const [kind, id] = event.target.value.split(":");
                if (kind === "portion") {
                  setPortionToLinkId(id);
                  setSelectedItemId("");
                } else {
                  setSelectedItemId(id ?? "");
                  setPortionToLinkId("");
                }
                setQuickAddItemError(null);
                setQuickAddItemSuccess(null);
              }}
              disabled={itemOptions.length === 0 && sellableOptions.length === 0}
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            >
              {itemOptions.length === 0 ? <option value="">Create a menu portion first</option> : null}
              <optgroup label="Sides and Accompaniments">
                {sellableOptions.map((option) => {
                  const linkedItem = itemOptions.find((item) => item.directSellablePortionTypeId === option.portionTypeId);
                  return (
                    <option
                      key={option.portionTypeId}
                      value={linkedItem ? `item:${linkedItem.id}` : `portion:${option.portionTypeId}`}
                    >
                      {option.menuItemName} — {option.portionLabel}{linkedItem ? "" : " — link once"}
                    </option>
                  );
                })}
              </optgroup>
              <optgroup label="Drinks">
                {itemOptions.filter((item) => item.sourceMenuCategoryCode === "drinks").map((item) => (
                  <option key={item.id} value={`item:${item.id}`}>
                    {item.displayName ?? item.name}{item.portionLabel ? ` — ${item.portionLabel}` : ""}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Other inputs">
                {itemOptions.filter((item) => !mappedNonDrinkInventoryIds.has(item.id) && item.sourceMenuCategoryCode !== "drinks").map((item) => (
                  <option key={item.id} value={`item:${item.id}`}>
                    {item.name}{item.portionLabel ? ` — ${item.portionLabel} input` : " — raw input"}
                  </option>
                ))}
              </optgroup>
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
              {isQuickAddItemOpen ? "Close raw input" : "Add raw input"}
            </button>
          </label>

          <input type="hidden" name="inventory_item_id" value={selectedItemId} />

          {portionToLink ? (
            <div className="rounded-[22px] border border-[#F3D7A6] bg-[#FFF9ED] px-4 py-4">
              <p className="text-sm font-semibold text-[#111418]">Link this portion once</p>
              <p className="mt-1 text-sm leading-6 text-[#6B7280]">
                {portionToLink.menuItemName} — {portionToLink.portionLabel}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#6B7280]">After linking, staff can simply choose it and enter the restocking amount.</p>
              <button
                type="button"
                onClick={handleLinkPortion}
                disabled={isCreatingItem}
                className="mt-3 w-full rounded-2xl bg-[#111418] px-4 py-3 text-sm font-semibold text-white disabled:opacity-70"
              >
                {isCreatingItem ? "Linking portion..." : "Link this portion"}
              </button>
            </div>
          ) : null}

          {!isQuickAddItemOpen && quickAddItemError ? (
            <div className="rounded-[20px] border border-[#F4C7C7] bg-[#FFF8F8] px-4 py-3 text-sm leading-6 text-[#8A1C1C]">
              {quickAddItemError}
            </div>
          ) : null}
          {!isQuickAddItemOpen && quickAddItemSuccess ? (
            <div className="rounded-[20px] border border-[#CFE8D6] bg-[#F2FBF5] px-4 py-3 text-sm leading-6 text-[#166534]">
              {quickAddItemSuccess}
            </div>
          ) : null}

          {selectedItem ? (
            <>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Batch number</span>
            <input
              value={batchPreviewValue}
              readOnly
              disabled
              className="w-full rounded-2xl border border-[#D7DDE4] bg-[#F8FAFB] px-3 py-2.5 text-[#111418] opacity-100"
            />
            <p className="text-xs leading-5 text-[#6B7280]">
              Generated automatically when the intake is saved using the tracked item code, delivery date, and Kampala time.
            </p>
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Delivery date</span>
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
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">
              {selectedItem?.directSellablePortionTypeId ? "Restocking amount" : receivesPieces ? "Pieces Received" : `Quantity received${selectedItem ? ` (${selectedItem.unitName})` : ""}`}
            </span>
            <input
              type="number"
              min={selectedItem?.requiresWholeInput ? "1" : "0.01"}
              step={selectedItem?.requiresWholeInput ? "1" : "0.01"}
              name="quantity_received"
              required
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
            {selectedItem?.directSellablePortionTypeId ? (
              <p className="text-xs leading-5 text-[#6B7280]">
                Enter how many of the selected portion are being added.
              </p>
            ) : null}
          </label>

          <label className="space-y-2 text-sm text-[#6B7280]">
            <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Unit cost</span>
            <UgxAmountInput
              allowDecimals
              min="0"
              step="0.01"
              name="unit_cost"
              placeholder="Optional"
              className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
            />
          </label>
            </>
          ) : null}
        </div>

        {selectedItem ? (
          <>
        {selectedItem?.directSellablePortionTypeId ? (
          <article className="rounded-[22px] border border-[#CFE8D6] bg-[#F2FBF5] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#15803D]">Stock destination</p>
            <p className="mt-2 text-base font-semibold text-[#111418]">Sellable finished stock</p>
            <p className="mt-1 text-sm leading-6 text-[#6B7280]">
              Saving adds these portions to {selectedItem.displayName ?? selectedItem.name} immediately.
            </p>
          </article>
        ) : selectedItem ? (
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
            placeholder="Receiving remarks for this sides and drinks intake"
            className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-[#111418]"
          />
        </label>

        <button
          type="submit"
          disabled={supplierOptions.length === 0 || !selectedItemId || Boolean(portionToLinkId)}
          className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          Save sides and drinks intake
        </button>
        {supplierOptions.length === 0 ? (
          <p className="text-sm leading-6 text-[#6B7280]">
            Add a supplier first so this sides and drinks intake is recorded against a saved supplier.
          </p>
        ) : null}
        {itemOptions.length === 0 ? (
          <p className="text-sm leading-6 text-[#6B7280]">
            Add a tracked side item or create a drink on the Menu page first.
          </p>
        ) : null}
            </>
          ) : null}
          </form>
          <form id="sides-quick-add-supplier-form" onSubmit={handleQuickAddSupplier}></form>
          <form id="sides-quick-add-item-form" onSubmit={handleQuickAddItem}></form>
        </>
      ) : (
        <div className="mt-4 rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
          Expand this card when you need to receive fries, gonja, juice, yoghurt, soda, or other tracked side and drink
          inputs. Menu-created drinks and mapped legacy items post straight into sellable stock; raw side inputs do not.
        </div>
      )}
    </section>
  );
}
