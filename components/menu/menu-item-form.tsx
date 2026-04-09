"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveMenuItemDetailsAction, uploadMenuItemImageAction } from "@/lib/ops/actions";
import { MenuItemRecord, PortionTypeOption, MenuCategoryRecord } from "@/lib/ops/types";

type SavePhase = "idle" | "creating" | "saving" | "uploading" | "finishing";

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
  const isEditing = Boolean(selectedMenuItem);
  const isPending = phase !== "idle";

  useEffect(() => {
    setPhase("idle");
    setErrorMessage(null);
  }, [selectedMenuItem?.id]);

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
          <option key={portion.id} value={portion.id} disabled={portion.isAssigned}>
            {portion.label}
            {portion.isAssigned ? " - already linked" : ""}
          </option>
        ))}
      </select>
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
        <input
          id="menu-base-price"
          type="number"
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
          className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
        />
        <p className="text-xs leading-5 text-[#6B7280]">
          Upload a JPG, PNG, or WebP image up to 5MB. A new upload replaces the current image for this item.
        </p>
      </div>
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
  );
}
