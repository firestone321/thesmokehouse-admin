import Link from "next/link";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { adjustInventoryItemAction, saveInventoryItemAction } from "@/lib/ops/actions";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getInventoryPageData } from "@/lib/ops/queries";
import { DailyStockRow } from "@/lib/ops/types";
import { formatDateTime, formatServiceDate } from "@/lib/ops/utils";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatQuantity(value: number, unit: string) {
  return `${value.toFixed(2)} ${unit}`;
}

export default async function InventoryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const selectedItemId = getFirstValue(params.item) ?? null;
  let data;

  try {
    data = await getInventoryPageData(selectedItemId);
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Inventory cannot load yet" error={error} />;
    }

    throw error;
  }

  const { serviceDate, dailyStock, inventoryItems, selectedItem, movementHistory } = data;

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Inventory</p>
        <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Daily stock and tracked inventory</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Today&apos;s portion stock comes from `daily_stock`, while adjustments and movement history for tracked
              items come from live inventory tables and database functions.
            </p>
          </div>
          <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3 text-sm text-[#6B7280]">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Service day</p>
            <p className="mt-1 font-semibold text-[#111418]">{formatServiceDate(serviceDate)}</p>
          </div>
        </div>
      </section>

      <section className="surface-card rounded-[32px] p-5">
        <div className="border-b border-[#EEF2F6] pb-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Today&apos;s menu stock</p>
          <h2 className="mt-2 text-xl font-semibold">How much sellable stock is left today</h2>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {dailyStock.map((row: DailyStockRow) => (
            <article key={row.portionTypeId} className="rounded-[24px] border border-[#E4E7EB] bg-white px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[#111418]">
                    {row.portionName}{row.portionLabel ? ` (${row.portionLabel})` : ""}
                  </h3>
                  <p className="text-sm text-[#6B7280]">{row.proteinName ?? "General"}{row.packagingTypeName ? ` | ${row.packagingTypeName}` : ""}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                    row.isLowStock ? "bg-[#FDECEC] text-[#D32F2F]" : "bg-[#ECFDF3] text-[#15803D]"
                  }`}
                >
                  {row.isInitialized ? (row.isLowStock ? "low" : "healthy") : "not set"}
                </span>
              </div>

              <div className="mt-4 grid gap-3 text-sm text-[#6B7280] sm:grid-cols-2">
                <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Starting</p>
                  <p className="mt-1 font-semibold text-[#111418]">{row.startingQuantity}</p>
                </div>
                <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Remaining</p>
                  <p className="mt-1 font-semibold text-[#111418]">{row.remainingQuantity}</p>
                </div>
                <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Reserved</p>
                  <p className="mt-1 font-semibold text-[#111418]">{row.reservedQuantity}</p>
                </div>
                <div className="rounded-[18px] bg-[#F8FAFB] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Sold / waste</p>
                  <p className="mt-1 font-semibold text-[#111418]">
                    {row.soldQuantity} / {row.wasteQuantity}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <section className="surface-card rounded-[32px] p-5">
          <div className="border-b border-[#EEF2F6] pb-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Tracked items</p>
            <h2 className="mt-2 text-xl font-semibold">Adjustable inventory</h2>
          </div>

          <div className="mt-4 space-y-3">
            {inventoryItems.length > 0 ? (
              inventoryItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/inventory?item=${item.id}`}
                  className={`block rounded-[24px] border px-4 py-4 transition ${
                    selectedItem?.id === item.id
                      ? "border-[#111418] bg-[#F8FAFB]"
                      : "border-[#E4E7EB] bg-white hover:border-[#D0D7DE]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-[#111418]">{item.name}</h3>
                      <p className="text-sm text-[#6B7280]">{item.code} | {item.unitName}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                        item.isLowStock ? "bg-[#FDECEC] text-[#D32F2F]" : "bg-[#ECFDF3] text-[#15803D]"
                      }`}
                    >
                      {item.isLowStock ? "low stock" : "ok"}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-[#6B7280] sm:grid-cols-3">
                    <div className="rounded-[18px] bg-[#FFFFFF] px-3 py-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Current</p>
                      <p className="mt-1 font-semibold text-[#111418]">{formatQuantity(item.currentQuantity, item.unitName)}</p>
                    </div>
                    <div className="rounded-[18px] bg-[#FFFFFF] px-3 py-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Reorder</p>
                      <p className="mt-1 font-semibold text-[#111418]">{formatQuantity(item.reorderThreshold, item.unitName)}</p>
                    </div>
                    <div className="rounded-[18px] bg-[#FFFFFF] px-3 py-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Updated</p>
                      <p className="mt-1 font-semibold text-[#111418]">{formatDateTime(item.updatedAt)}</p>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
                No tracked inventory items exist yet. Create the first one in the panel on the right.
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Create item</p>
              <h2 className="mt-2 text-xl font-semibold">New inventory item</h2>
            </div>
            <form action={saveInventoryItemAction} className="mt-4 grid gap-3">
              <input
                name="code"
                placeholder="Code, e.g. charcoal_bag"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <input
                name="name"
                required
                placeholder="Name"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <input
                name="unit_name"
                required
                placeholder="Unit, e.g. kg, box, bottle"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                name="reorder_threshold"
                defaultValue="0"
                placeholder="Reorder threshold"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <input
                type="number"
                step="0.01"
                name="initial_quantity"
                defaultValue="0"
                placeholder="Initial quantity"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
                Create inventory item
              </button>
            </form>
          </section>

          {selectedItem ? (
            <>
              <section className="surface-card rounded-[32px] p-5">
                <div className="border-b border-[#EEF2F6] pb-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Selected item</p>
                  <h2 className="mt-2 text-xl font-semibold">{selectedItem.name}</h2>
                </div>

                <form action={saveInventoryItemAction} className="mt-4 grid gap-3">
                  <input type="hidden" name="inventory_item_id" value={selectedItem.id} />
                  <input
                    name="code"
                    required
                    defaultValue={selectedItem.code}
                    className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                  />
                  <input
                    name="name"
                    required
                    defaultValue={selectedItem.name}
                    className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                  />
                  <input
                    name="unit_name"
                    required
                    defaultValue={selectedItem.unitName}
                    className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="reorder_threshold"
                    defaultValue={selectedItem.reorderThreshold}
                    className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                  />
                  <input type="hidden" name="initial_quantity" value="0" />
                  <label className="flex items-center gap-2 text-sm text-[#6B7280]">
                    <input type="checkbox" name="is_active" defaultChecked={selectedItem.isActive} />
                    Active
                  </label>
                  <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
                    Save item details
                  </button>
                </form>
              </section>

              <section className="surface-card rounded-[32px] p-5">
                <div className="border-b border-[#EEF2F6] pb-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Adjustment</p>
                  <h2 className="mt-2 text-xl font-semibold">Record a movement</h2>
                </div>

                <form action={adjustInventoryItemAction} className="mt-4 grid gap-3">
                  <input type="hidden" name="inventory_item_id" value={selectedItem.id} />
                  <select
                    name="movement_type"
                    defaultValue="adjustment"
                    className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                  >
                    <option value="adjustment">Adjustment</option>
                    <option value="restock">Restock</option>
                    <option value="usage">Usage</option>
                    <option value="waste">Waste</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    name="quantity_delta"
                    required
                    placeholder="Use positive to add, negative to subtract"
                    className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                  />
                  <textarea
                    name="note"
                    rows={3}
                    placeholder="Why did this adjustment happen?"
                    className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-sm text-[#111418]"
                  />
                  <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
                    Record movement
                  </button>
                </form>
              </section>

              <section className="surface-card rounded-[32px] p-5">
                <div className="border-b border-[#EEF2F6] pb-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">History</p>
                  <h2 className="mt-2 text-xl font-semibold">Recent movements</h2>
                </div>
                <div className="mt-4 space-y-3">
                  {movementHistory.length > 0 ? (
                    movementHistory.map((movement) => (
                      <article key={movement.id} className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-[#111418]">{movement.movementType}</p>
                          <p className="text-sm text-[#6B7280]">{formatDateTime(movement.createdAt)}</p>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                          Delta {movement.quantityDelta.toFixed(2)} | New quantity {movement.resultingQuantity.toFixed(2)}
                        </p>
                        {movement.note ? <p className="mt-2 text-sm leading-6 text-[#6B7280]">{movement.note}</p> : null}
                      </article>
                    ))
                  ) : (
                    <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                      No movements have been recorded for this item yet.
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
