import Link from "next/link";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import {
  addMenuItemComponentAction,
  deleteMenuItemAction,
  removeMenuItemComponentAction,
  saveMenuCategoryAction,
  saveMenuItemAction,
  toggleMenuItemActiveAction,
  toggleMenuItemAvailabilityAction
} from "@/lib/ops/actions";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getMenuPageData } from "@/lib/ops/queries";
import { formatCurrency } from "@/lib/ops/utils";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MenuPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const editMenuItemId = getFirstValue(params.edit) ?? null;
  let data;

  try {
    data = await getMenuPageData(editMenuItemId);
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Menu cannot load yet" error={error} />;
    }

    throw error;
  }

  const { categories, portionTypes, inventoryItems, menuItems, selectedMenuItem } = data;

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Menu</p>
        <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Live menu administration</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Menu items are now backed by Supabase and tied directly to portion definitions, pricing, category, daily
              availability, and tracked inventory components.
            </p>
          </div>
          <Link href="/menu" className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]">
            Clear selection
          </Link>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_380px]">
        <section className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Menu items</p>
              <h2 className="mt-2 text-xl font-semibold">Current sellable items</h2>
            </div>

            <div className="mt-4 space-y-3">
              {menuItems.length > 0 ? (
                menuItems.map((item) => (
                  <article key={item.id} className="rounded-[24px] border border-[#E4E7EB] bg-white px-4 py-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-[#111418]">{item.name}</h3>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                              item.isActive ? "bg-[#ECFDF3] text-[#15803D]" : "bg-[#F3F4F6] text-[#4B5563]"
                            }`}
                          >
                            {item.isActive ? "active" : "inactive"}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                              item.isAvailableToday ? "bg-[#EEF2FF] text-[#4338CA]" : "bg-[#FDECEC] text-[#D32F2F]"
                            }`}
                          >
                            {item.isAvailableToday ? "available today" : "hidden today"}
                          </span>
                        </div>
                        <p className="text-sm text-[#6B7280]">
                          {item.categoryName} • {item.portionLabel} • {item.prepType}
                        </p>
                        {item.description ? <p className="text-sm leading-6 text-[#6B7280]">{item.description}</p> : null}
                        <p className="text-sm font-semibold text-[#111418]">{formatCurrency(item.basePrice)}</p>
                      </div>

                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        <Link
                          href={`/menu?edit=${item.id}`}
                          className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2 text-sm font-semibold text-[#111418]"
                        >
                          Edit
                        </Link>

                        <form action={toggleMenuItemActiveAction}>
                          <input type="hidden" name="menu_item_id" value={item.id} />
                          <input type="hidden" name="next_value" value={item.isActive ? "false" : "true"} />
                          <button type="submit" className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2 text-sm font-semibold text-[#111418]">
                            {item.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </form>

                        <form action={toggleMenuItemAvailabilityAction}>
                          <input type="hidden" name="menu_item_id" value={item.id} />
                          <input type="hidden" name="next_value" value={item.isAvailableToday ? "false" : "true"} />
                          <button type="submit" className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2 text-sm font-semibold text-[#111418]">
                            {item.isAvailableToday ? "Hide today" : "Make available"}
                          </button>
                        </form>
                      </div>
                    </div>

                    {item.components.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.components.map((component) => (
                          <span
                            key={component.id}
                            className="rounded-full bg-[#F8FAFB] px-3 py-1 text-xs font-semibold text-[#4B5563]"
                          >
                            {component.inventoryItemName} x {component.quantityRequired} {component.unitName}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="rounded-[24px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
                  No menu items exist yet. Use the form on the right to create the first live sellable item.
                </div>
              )}
            </div>
          </section>
        </section>

        <aside className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Category</p>
              <h2 className="mt-2 text-xl font-semibold">Add a menu category</h2>
            </div>
            <form action={saveMenuCategoryAction} className="mt-4 grid gap-3">
              <input
                name="code"
                placeholder="Code, e.g. drinks"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <input
                name="name"
                required
                placeholder="Category name"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <input
                type="number"
                min="1"
                name="sort_order"
                defaultValue="1"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
                Save category
              </button>
            </form>
          </section>

          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">
                {selectedMenuItem ? "Edit menu item" : "New menu item"}
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                {selectedMenuItem ? selectedMenuItem.name : "Create a sellable item"}
              </h2>
            </div>
            <form action={saveMenuItemAction} className="mt-4 grid gap-3">
              {selectedMenuItem ? <input type="hidden" name="menu_item_id" value={selectedMenuItem.id} /> : null}
              <input
                name="code"
                defaultValue={selectedMenuItem?.code}
                placeholder="Code, e.g. beef_ribs"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <input
                name="name"
                required
                defaultValue={selectedMenuItem?.name}
                placeholder="Display name"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <textarea
                name="description"
                rows={3}
                defaultValue={selectedMenuItem?.description ?? ""}
                placeholder="Short description"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-sm text-[#111418]"
              />
              <select
                name="menu_category_id"
                defaultValue={selectedMenuItem?.categoryId}
                required
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              >
                <option value="">Select category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <select
                name="portion_type_id"
                defaultValue={selectedMenuItem?.portionTypeId}
                required
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              >
                <option value="">Select portion type</option>
                {portionTypes.map((portion) => (
                  <option key={portion.id} value={portion.id}>
                    {portion.label}
                  </option>
                ))}
              </select>
              <select
                name="prep_type"
                defaultValue={selectedMenuItem?.prepType ?? "smoked"}
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              >
                <option value="smoked">Smoked</option>
                <option value="packed">Packed</option>
                <option value="drink">Drink</option>
              </select>
              <input
                type="number"
                min="0"
                name="base_price"
                required
                defaultValue={selectedMenuItem?.basePrice ?? 0}
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <input
                type="number"
                min="1"
                name="sort_order"
                defaultValue={selectedMenuItem?.sortOrder ?? menuItems.length + 1}
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <label className="flex items-center gap-2 text-sm text-[#6B7280]">
                <input type="checkbox" name="is_active" defaultChecked={selectedMenuItem?.isActive ?? true} />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm text-[#6B7280]">
                <input
                  type="checkbox"
                  name="is_available_today"
                  defaultChecked={selectedMenuItem?.isAvailableToday ?? true}
                />
                Available today
              </label>
              <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
                {selectedMenuItem ? "Save menu item" : "Create menu item"}
              </button>
            </form>

            {selectedMenuItem ? (
              <form action={deleteMenuItemAction} className="mt-3">
                <input type="hidden" name="menu_item_id" value={selectedMenuItem.id} />
                <button type="submit" className="rounded-2xl border border-[#F4C7C7] px-4 py-2.5 text-sm font-semibold text-[#D32F2F]">
                  Delete menu item
                </button>
              </form>
            ) : null}
          </section>

          {selectedMenuItem ? (
            <section className="surface-card rounded-[32px] p-5">
              <div className="border-b border-[#EEF2F6] pb-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Components</p>
                <h2 className="mt-2 text-xl font-semibold">Linked inventory items</h2>
              </div>

              <form action={addMenuItemComponentAction} className="mt-4 grid gap-3">
                <input type="hidden" name="menu_item_id" value={selectedMenuItem.id} />
                <select
                  name="inventory_item_id"
                  required
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                >
                  <option value="">Select inventory item</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.unitName})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  name="quantity_required"
                  required
                  placeholder="Quantity required per menu item"
                  className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
                />
                <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
                  Save component link
                </button>
              </form>

              <div className="mt-4 space-y-3">
                {selectedMenuItem.components.length > 0 ? (
                  selectedMenuItem.components.map((component) => (
                    <article key={component.id} className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[#111418]">{component.inventoryItemName}</p>
                          <p className="text-sm text-[#6B7280]">
                            {component.quantityRequired} {component.unitName} per menu item
                          </p>
                        </div>
                        <form action={removeMenuItemComponentAction}>
                          <input type="hidden" name="component_id" value={component.id} />
                          <input type="hidden" name="menu_item_id" value={selectedMenuItem.id} />
                          <button type="submit" className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2 text-sm font-semibold text-[#111418]">
                            Remove
                          </button>
                        </form>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                    This menu item has no linked inventory components yet.
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
