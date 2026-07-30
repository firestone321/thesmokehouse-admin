"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UgxAmountInput } from "@/components/ugx-amount-input";
import { createPortionTypeInlineAction, saveMenuItemDetailsAction, uploadMenuItemImageAction } from "@/lib/ops/actions";
import { MenuItemRecord, PortionTypeOption, MenuCategoryRecord } from "@/lib/ops/types";

type SavePhase = "idle" | "creating" | "saving" | "uploading" | "finishing";
const maxMenuImageBytes = 10 * 1024 * 1024;

function getStatusLabel(phase: SavePhase, isEditing: boolean) {
  switch (phase) {
    case "creating":
      return "Creating sellable item...";
    case "saving":
      return "Saving changes...";
    case "uploading":
      return "Uploading image...";
    case "finishing":
      return "Finishing up...";
    default:
      return isEditing ? "Save menu item" : "Create menu item";
  }
}

export function MenuItemForm({
  categories,
  portionTypes,
  selectedMenuItem,
  nextSortOrder
}: {
  categories: MenuCategoryRecord[];
  portionTypes: PortionTypeOption[];
  selectedMenuItem: MenuItemRecord | null;
  nextSortOrder: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [portionOptions, setPortionOptions] = useState(portionTypes);
  const [portionTypeId, setPortionTypeId] = useState<string>(selectedMenuItem?.portionTypeId ? String(selectedMenuItem.portionTypeId) : "");
  const [menuCategoryId, setMenuCategoryId] = useState<string>(selectedMenuItem?.categoryId ? String(selectedMenuItem.categoryId) : "");
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(portionTypes.length === 0);
  const [isCreatingPortionType, setIsCreatingPortionType] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [quickAddSuccess, setQuickAddSuccess] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<{ name: string; url: string } | null>(null);
  const isEditing = Boolean(selectedMenuItem);
  const isPending = phase !== "idle";
  const selectedCategory = categories.find((category) => String(category.id) === menuCategoryId);
  const isDrinkCategory = selectedCategory?.code === "drinks" || selectedCategory?.name?.toLowerCase() === "drinks";
  const portionUnit = isDrinkCategory ? "ml" : "g";
  const portionUnitLabel = isDrinkCategory ? "Milliliters" : "Grams";

  useEffect(() => {
    setPhase("idle");
    setErrorMessage(null);
  }, [selectedMenuItem?.id]);

  useEffect(() => {
    setPortionOptions(portionTypes);
    setPortionTypeId(selectedMenuItem?.portionTypeId ? String(selectedMenuItem.portionTypeId) : "");
    setIsQuickAddOpen(portionTypes.length === 0);
    setIsCreatingPortionType(false);
    setQuickAddError(null);
    setQuickAddSuccess(null);
  }, [portionTypes, selectedMenuItem?.id, selectedMenuItem?.portionTypeId]);

  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview.url);
      }
    };
  }, [imagePreview]);

  function handleImageSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    setImagePreview(file ? { name: file.name, url: URL.createObjectURL(file) } : null);
  }

  async function handleQuickAddPortionType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuickAddError(null);
    setQuickAddSuccess(null);
    setIsCreatingPortionType(true);

    try {
      const result = await createPortionTypeInlineAction(new FormData(event.currentTarget));

      if (!result.ok) {
        setQuickAddError("Unable to create portion type.");
        return;
      }

      setPortionOptions((currentOptions) => {
        const nextOptions = currentOptions.filter((option) => option.id !== result.portionType.id);
        nextOptions.push(result.portionType);
        nextOptions.sort((left, right) => left.label.localeCompare(right.label));
        return nextOptions;
      });
      setPortionTypeId(String(result.portionType.id));
      setQuickAddSuccess(`${result.portionType.label} is ready to use for this menu item.`);
      setIsQuickAddOpen(false);
      event.currentTarget.reset();
    } catch (error) {
      setQuickAddError(error instanceof Error ? error.message : "Unable to create portion type.");
    } finally {
      setIsCreatingPortionType(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const imageValue = formData.get("image");
    const hasImage = imageValue instanceof File && imageValue.size > 0;
    const detailsFormData = new FormData();

    formData.forEach((value, key) => {
      if (key !== "image") {
        detailsFormData.append(key, value);
      }
    });

    setPhase(isEditing ? "saving" : "creating");

    try {
      const saveResult = await saveMenuItemDetailsAction(detailsFormData);

      if (!saveResult.ok) {
        setErrorMessage(saveResult.error);
        setPhase("idle");
        return;
      }

      if (hasImage && imageValue instanceof File && imageValue.size > maxMenuImageBytes) {
        const error = "Menu image must be 10MB or smaller.";

        setPhase("finishing");
        router.refresh();

        if (!isEditing || selectedMenuItem?.id !== saveResult.menuItemId) {
          router.push(`/menu?edit=${saveResult.menuItemId}&error=${encodeURIComponent(error)}`);
          return;
        }

        setErrorMessage(error);
        setPhase("idle");
        return;
      }

      if (hasImage && imageValue instanceof File) {
        setPhase("uploading");
        const imageFormData = new FormData();
        imageFormData.append("menu_item_id", String(saveResult.menuItemId));
        imageFormData.append("image", imageValue);
        await uploadMenuItemImageAction(imageFormData);
      }

      setPhase("finishing");
      router.refresh();

      if (!isEditing || selectedMenuItem?.id !== saveResult.menuItemId) {
        router.push(`/menu?edit=${saveResult.menuItemId}`);
        return;
      }

      setPhase("idle");
    } catch (error) {
      setPhase("idle");
      setErrorMessage(error instanceof Error ? error.message : "Unable to save the menu item.");
    }
  }

  return (
    <>
      <form id="menu-quick-add-portion-form" onSubmit={handleQuickAddPortionType}></form>
      <form onSubmit={handleSubmit} className="mt-4 grid gap-3">
        {selectedMenuItem ? <input type="hidden" name="menu_item_id" value={selectedMenuItem.id} /> : null}
        <input
          name="name"
          required
          defaultValue={selectedMenuItem?.name}
          placeholder="Display name"
          className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
        />
        <p className="text-xs leading-5 text-[#6B7280]">Code is generated automatically from the name when the item is created.</p>
        <textarea
          name="description"
          rows={3}
          defaultValue={selectedMenuItem?.description ?? ""}
          placeholder="Short description"
          className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-sm text-[#111418]"
        />
        <select
          name="menu_category_id"
          value={menuCategoryId}
          onChange={(event) => setMenuCategoryId(event.target.value)}
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
        <label className="space-y-2 text-sm text-[#6B7280]">
          <span className="block text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Portion type</span>
          <select
            name="portion_type_id"
            value={portionTypeId}
            onChange={(event) => setPortionTypeId(event.target.value)}
            required
            className="w-full rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-[#111418]"
          >
            <option value="">Select portion type</option>
            {portionOptions.map((portion) => (
              <option key={portion.id} value={portion.id} disabled={portion.isAssigned}>
                {portion.label}
                {portion.isAssigned ? " - already linked" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setIsQuickAddOpen((current) => !current);
              setQuickAddError(null);
              setQuickAddSuccess(null);
            }}
            className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-[#D7DDE4] bg-[#F8FAFB] px-2.5 py-1.5 text-xs font-semibold text-[#374151] transition hover:border-[#BFC7D1] hover:bg-white"
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {isQuickAddOpen ? "×" : "+"}
            </span>
            {isQuickAddOpen ? "Close add portion" : "Add portion"}
          </button>
          <p className="text-xs leading-5 text-[#6B7280]">
            Portion code is generated from the name, and the size label follows the selected category.
          </p>
        </label>

        {isQuickAddOpen ? (
          <div className="grid gap-3 rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
            <div className="grid gap-3">
              <input
                id="menu-quick-add-portion-name"
                form="menu-quick-add-portion-form"
                name="name"
                required
                placeholder="Portion name, e.g. Kachumbari"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
              <input
                type="hidden"
                form="menu-quick-add-portion-form"
                name="unit"
                value={portionUnit}
              />
              <input
                id="menu-quick-add-portion-quantity"
                form="menu-quick-add-portion-form"
                type="number"
                min="1"
                step="1"
                name="quantity"
                required
                placeholder={`${portionUnitLabel}, e.g. ${isDrinkCategory ? "500" : "250"}`}
                className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
              />
            </div>

            {quickAddError ? (
              <div className="rounded-[20px] border border-[#F4C7C7] bg-[#FFF8F8] px-4 py-3 text-sm leading-6 text-[#8A1C1C]">
                {quickAddError}
              </div>
            ) : null}

            <button
              type="submit"
              form="menu-quick-add-portion-form"
              disabled={isCreatingPortionType}
              className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isCreatingPortionType ? "Creating portion..." : "Create portion and use it"}
            </button>
          </div>
        ) : null}

        {quickAddSuccess ? (
          <div className="rounded-[20px] border border-[#CDE7D8] bg-[#F2FBF5] px-4 py-3 text-sm leading-6 text-[#166534]">
            {quickAddSuccess}
          </div>
        ) : null}
        <div className="grid gap-2">
          <label className="text-sm font-semibold text-[#111418]" htmlFor="menu-preparation-flow">
            Preparation type
          </label>
          <select
            id="menu-preparation-flow"
            name="prep_type"
            defaultValue={selectedMenuItem?.prepType ?? "smoked"}
            className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
          >
            <option value="smoked">Roasted</option>
            <option value="packed">Kitchen</option>
            <option value="drink">Drink</option>
          </select>
          <p className="text-xs leading-5 text-[#6B7280]">Choose how this item is prepared or handled.</p>
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-semibold text-[#111418]" htmlFor="menu-base-price">
            Base price
          </label>
          <UgxAmountInput
            id="menu-base-price"
            min="0"
            name="base_price"
            required
            defaultValue={selectedMenuItem?.basePrice ?? 0}
            placeholder="Base price"
            className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
          />
        </div>
        <input type="hidden" name="sort_order" value={selectedMenuItem?.sortOrder ?? nextSortOrder} />
        {selectedMenuItem?.imageUrl ? (
          <div className="overflow-hidden rounded-[24px] border border-[#E4E7EB] bg-white">
            <img src={selectedMenuItem.imageUrl} alt={selectedMenuItem.name} className="h-52 w-full object-cover" />
          </div>
        ) : null}
        <div className="grid gap-2">
          <label className="text-sm font-semibold text-[#111418]" htmlFor="menu-image">
            Menu image
          </label>
          <input
            id="menu-image"
            type="file"
            name="image"
            accept="image/png,image/jpeg,image/webp"
            onChange={isEditing ? undefined : handleImageSelection}
            className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
          />
          <p className="text-xs leading-5 text-[#6B7280]">
            {isEditing
              ? "Upload a JPG, PNG, or WebP image up to 10MB. A new upload replaces the current image for this item."
              : "Upload a JPG, PNG, or WebP image up to 10MB. You will see a local preview before creating the item."}
          </p>
        </div>
        {!isEditing && imagePreview ? (
          <div className="overflow-hidden rounded-[24px] border border-[#E4E7EB] bg-[#F8FAFB]">
            <img src={imagePreview.url} alt={`Local preview of ${imagePreview.name}`} className="h-52 w-full object-cover" />
            <div className="border-t border-[#E4E7EB] px-4 py-3">
              <p className="text-sm font-semibold text-[#111418]">Local image preview</p>
              <p className="mt-1 truncate text-xs text-[#6B7280]">{imagePreview.name} · Not uploaded yet</p>
            </div>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-[#6B7280]">
          <input type="checkbox" name="is_active" defaultChecked={selectedMenuItem?.isActive ?? true} />
          Active
        </label>
        <label className="flex items-center gap-2 text-sm text-[#6B7280]">
          <input type="checkbox" name="is_available_today" defaultChecked={selectedMenuItem?.isAvailableToday ?? true} />
          Available today
        </label>

        {errorMessage ? (
          <div className="rounded-[22px] border border-[#F4C7C7] bg-[#FFF8F8] px-4 py-3 text-sm leading-6 text-[#8A1C1C]">
            {errorMessage}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {getStatusLabel(phase, isEditing)}
        </button>

        {isPending ? (
          <p className="text-xs leading-5 text-[#6B7280]">
            {phase === "uploading"
              ? "The image is uploading now."
              : phase === "creating"
                ? "The sellable item record is being created now."
                : phase === "saving"
                  ? "The menu item changes are being saved now."
                  : "Refreshing the page with the latest data."}
          </p>
        ) : null}
      </form>
    </>
  );
}
