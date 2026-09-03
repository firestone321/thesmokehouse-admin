"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UgxAmountInput } from "@/components/ugx-amount-input";
import { createPortionTypeInlineAction, saveMenuItemDetailsAction, uploadMenuItemImageAction } from "@/lib/ops/actions";
import { MenuItemRecord, PortionTypeOption, MenuCategoryRecord } from "@/lib/ops/types";

type SavePhase = "idle" | "creating" | "saving" | "uploading";
const maxMenuImageBytes = 10 * 1024 * 1024;

function getStatusLabel(phase: SavePhase, isEditing: boolean) {
  switch (phase) {
    case "creating":
      return "Creating sellable item...";
    case "saving":
      return "Saving changes...";
    case "uploading":
      return "Uploading image...";
    default:
      return isEditing ? "Save menu item" : "Create menu item";
  }
}

const fieldClassName =
  "min-h-11 rounded-2xl border border-[#CDD4DC] bg-[#FFFDF9] px-3 py-2.5 text-sm text-[#111418] shadow-sm transition hover:border-[#AEB8C3] hover:shadow-md focus:border-[#B85C38] focus:outline-none focus:ring-4 focus:ring-[#B85C38]/10";

const selectClassName = fieldClassName + " w-full cursor-pointer appearance-none pr-10";

const sectionClassName =
  "grid gap-4 rounded-[22px] border border-[#E5DED6] border-l-[3px] border-l-[#B85C38] bg-[#FFFEFC] px-4 py-5 shadow-[0_8px_24px_rgba(45,34,25,0.045)] sm:px-5";

function FormSectionHeading({ icon, title }: { icon: "details" | "portion" | "price" | "image" | "availability"; title: string }) {
  const paths = {
    details: <path d="M7 7h10M7 12h10M7 17h6" />,
    portion: <path d="M7 4v5M5 4v3a2 2 0 0 0 4 0V4M7 9v11M15 4v16M15 4c2 1 3 3 3 6h-3" />,
    price: (
      <text x="12" y="14" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7" fontWeight="800">
        UGX
      </text>
    ),
    image: <path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01" />,
    availability: <path d="M20 11a8 8 0 1 1-4.6-7.25M9 11l2 2 7-8" />
  } as const;

  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#F4ECE7] text-[#70412D]" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]">
          {paths[icon]}
        </svg>
      </span>
      <h3 className="text-sm font-bold tracking-[-0.01em] text-[#2D2219]">{title}</h3>
    </div>
  );
}

function SelectChevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#8B6754] transition-colors group-hover:text-[#B85C38] group-focus-within:text-[#B85C38]"
      aria-hidden="true"
    >
      <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MenuItemForm({
  categories,
  portionTypes,
  selectedMenuItem,
  nextSortOrder,
  canEditDetails = true
}: {
  categories: MenuCategoryRecord[];
  portionTypes: PortionTypeOption[];
  selectedMenuItem: MenuItemRecord | null;
  nextSortOrder: number;
  canEditDetails?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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
  const [availabilityDays, setAvailabilityDays] = useState<number[]>(selectedMenuItem?.availabilityDays ?? [0, 1, 2, 3, 4, 5, 6]);

  useEffect(() => {
    setPhase("idle");
    setErrorMessage(null);
    setSuccessMessage(null);
    setAvailabilityDays(selectedMenuItem?.availabilityDays ?? [0, 1, 2, 3, 4, 5, 6]);
  }, [selectedMenuItem?.id]);

  useEffect(() => {
    setPortionOptions(portionTypes);
    setPortionTypeId(selectedMenuItem?.portionTypeId ? String(selectedMenuItem.portionTypeId) : "");
    setAvailabilityDays(selectedMenuItem?.availabilityDays ?? [0, 1, 2, 3, 4, 5, 6]);
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

  function finishCreatedMenuItem(form: HTMLFormElement, menuItemId: number, error?: string) {
    form.reset();
    setMenuCategoryId("");
    setPortionTypeId("");
    setImagePreview(null);
    setQuickAddError(null);
    setQuickAddSuccess(null);
    setPhase("idle");

    const destination = error
      ? `/menu?edit=${menuItemId}&error=${encodeURIComponent(error)}`
      : `/menu?edit=${menuItemId}`;

    router.replace(destination, { scroll: false });
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
    setSuccessMessage(null);

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

        if (!isEditing || selectedMenuItem?.id !== saveResult.menuItemId) {
          finishCreatedMenuItem(form, saveResult.menuItemId, error);
          return;
        }

        setErrorMessage(error);
        setPhase("idle");
        router.refresh();
        return;
      }

      if (saveResult.priceApprovalPending) {
        setSuccessMessage(
          `Your other changes were saved. The suggested price was sent to a manager for approval. The live price remains UGX ${Number(saveResult.livePrice).toLocaleString("en-UG")}.`
        );
      }

      if (hasImage && imageValue instanceof File) {
        setPhase("uploading");
        const imageFormData = new FormData();
        imageFormData.append("menu_item_id", String(saveResult.menuItemId));
        imageFormData.append("image", imageValue);
        await uploadMenuItemImageAction(imageFormData);
      }

      if (!isEditing || selectedMenuItem?.id !== saveResult.menuItemId) {
        finishCreatedMenuItem(form, saveResult.menuItemId);
        return;
      }

      setPhase("idle");
      router.refresh();
    } catch (error) {
      setPhase("idle");
      setErrorMessage(error instanceof Error ? error.message : "Unable to save the menu item.");
    }
  }

  return (
    <>
      <form id="menu-quick-add-portion-form" onSubmit={handleQuickAddPortionType}></form>
      <form onSubmit={handleSubmit} className="mt-5 grid gap-5">
        {selectedMenuItem ? <input type="hidden" name="menu_item_id" value={selectedMenuItem.id} /> : null}
        {!canEditDetails && selectedMenuItem ? (
          <>
            <input type="hidden" name="name" value={selectedMenuItem.name} />
            <input type="hidden" name="description" value={selectedMenuItem.description ?? ""} />
            <input type="hidden" name="base_price" value={selectedMenuItem.basePrice} />
            <input type="hidden" name="prep_type" value={selectedMenuItem.prepType} />
            <input type="hidden" name="menu_category_id" value={selectedMenuItem.categoryId} />
            <input type="hidden" name="portion_type_id" value={selectedMenuItem.portionTypeId} />
            <input type="hidden" name="sort_order" value={selectedMenuItem.sortOrder} />
            <input type="hidden" name="is_active" value={String(selectedMenuItem.isActive)} />
          </>
        ) : null}
        <fieldset disabled={!canEditDetails} className="grid gap-5">
        <section className={sectionClassName} aria-labelledby="menu-item-details-heading">
          <div id="menu-item-details-heading">
            <FormSectionHeading icon="details" title="Item details" />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-semibold text-[#111418]" htmlFor="menu-item-name">
              Display name
            </label>
            <input
              id="menu-item-name"
              name="name"
              required
              defaultValue={selectedMenuItem?.name}
              placeholder="Display name"
              className={fieldClassName}
            />
            <p className="text-xs leading-5 text-[#6B7280]">Code is generated automatically from the name when the item is created.</p>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-semibold text-[#111418]" htmlFor="menu-item-description">
              Short description
            </label>
            <textarea
              id="menu-item-description"
              name="description"
              rows={3}
              defaultValue={selectedMenuItem?.description ?? ""}
              placeholder="Short description"
              className={fieldClassName}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-semibold text-[#111418]" htmlFor="menu-item-category">
              Category
            </label>
            <div className="group relative">
              <select
                id="menu-item-category"
                name="menu_category_id"
                value={menuCategoryId}
                onChange={(event) => setMenuCategoryId(event.target.value)}
                required
                className={selectClassName}
              >
                <option value="">Select category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </div>
        </section>

        <section className={sectionClassName} aria-labelledby="menu-portion-heading">
          <div id="menu-portion-heading">
            <FormSectionHeading icon="portion" title="Portion & preparation" />
          </div>
        <div className="grid gap-2">
          <label className="text-sm font-semibold text-[#111418]" htmlFor="menu-portion-type">
            Portion type
          </label>
          <div className="group relative">
            <select
              id="menu-portion-type"
              name="portion_type_id"
              value={portionTypeId}
              onChange={(event) => setPortionTypeId(event.target.value)}
              required
              className={selectClassName}
            >
              <option value="">Select portion type</option>
              {portionOptions.map((portion) => (
                <option key={portion.id} value={portion.id} disabled={portion.isAssigned}>
                  {portion.label}
                  {portion.isAssigned ? " - already linked" : ""}
                </option>
              ))}
            </select>
            <SelectChevron />
          </div>
          <button
            type="button"
            onClick={() => {
              setIsQuickAddOpen((current) => !current);
              setQuickAddError(null);
              setQuickAddSuccess(null);
            }}
            className="inline-flex min-h-[31px] w-fit items-center gap-[6.3px] rounded-xl border border-[#B85C38] bg-white px-[11.6px] py-[6.3px] text-[10.4px] font-semibold text-[#9A492D] shadow-sm transition hover:bg-[#FFF7F2] hover:shadow-md focus:outline-none focus:ring-4 focus:ring-[#B85C38]/10"
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {isQuickAddOpen ? "×" : "+"}
            </span>
            {isQuickAddOpen ? "Close add portion" : "Add portion"}
          </button>
          <p className="text-xs leading-5 text-[#6B7280]">
            Portion code is generated from the name, and the size label follows the selected category.
          </p>
        </div>

        {isQuickAddOpen ? (
          <div className="grid gap-3 rounded-[20px] border border-[#E1D6CC] bg-[#FAF7F3] px-4 py-4">
            <div className="grid gap-3">
              <input
                id="menu-quick-add-portion-name"
                form="menu-quick-add-portion-form"
                name="name"
                required
                placeholder="Portion name, e.g. Kachumbari"
                className={fieldClassName}
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
                className={fieldClassName}
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
              className="min-h-11 rounded-2xl border border-[#D7DDE4] bg-[#2D2219] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#18130F] focus:outline-none focus:ring-4 focus:ring-[#2D2219]/10 disabled:cursor-not-allowed disabled:opacity-70"
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
          <div className="group relative">
            <select
              id="menu-preparation-flow"
              name="prep_type"
              defaultValue={selectedMenuItem?.prepType ?? "smoked"}
              className={selectClassName}
            >
              <option value="smoked">Roasted</option>
              <option value="packed">Kitchen</option>
              <option value="drink">Drink</option>
            </select>
            <SelectChevron />
          </div>
          <p className="text-xs leading-5 text-[#6B7280]">Choose how this item is prepared or handled.</p>
        </div>
        </section>

        <section className={sectionClassName} aria-labelledby="menu-pricing-heading">
          <div id="menu-pricing-heading">
            <FormSectionHeading icon="price" title="Pricing" />
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
            className={fieldClassName}
          />
        </div>
        </section>
        <input type="hidden" name="sort_order" value={selectedMenuItem?.sortOrder ?? nextSortOrder} />
        <section className={sectionClassName} aria-labelledby="menu-image-heading">
          <div id="menu-image-heading">
            <FormSectionHeading icon="image" title="Menu image" />
          </div>
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
            className={fieldClassName}
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
        </section>
        </fieldset>

        <section className={sectionClassName} aria-labelledby="menu-availability-heading">
          <div id="menu-availability-heading">
            <FormSectionHeading icon="availability" title="Availability" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-[#DDD6CF] bg-[#FFFDF9] px-4 py-3 text-sm font-medium text-[#374151] transition hover:border-[#CBB8AA] hover:bg-white">
              <input type="hidden" name="is_active" value="false" />
              <input type="checkbox" name="is_active" defaultChecked={selectedMenuItem?.isActive ?? true} className="size-4 accent-[#B85C38]" />
              Active
            </label>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-[#DDD6CF] bg-[#FFFDF9] px-4 py-3 text-sm font-medium text-[#374151] transition hover:border-[#CBB8AA] hover:bg-white">
              <input type="hidden" name="is_available_today" value="false" />
              <input type="checkbox" name="is_available_today" defaultChecked={selectedMenuItem?.isAvailableToday ?? true} className="size-4 accent-[#B85C38]" />
              Available today
            </label>
          </div>
          <div className="grid gap-3 rounded-2xl border border-[#DDD6CF] bg-[#FFFDF9] p-4">
            <div>
              <p className="text-sm font-semibold text-[#111418]">Automatic availability schedule</p>
              <p className="mt-1 text-xs leading-5 text-[#6B7280]">Choose the days this item can be ordered. Optional dates limit the schedule to a season or promotion.</p>
            </div>
            <input type="hidden" name="availability_days" value={availabilityDays.join(",")} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => (
                <label key={day} className="flex items-center gap-2 rounded-xl border border-[#E5DED6] bg-white px-3 py-2 text-xs font-semibold text-[#374151]">
                  <input type="checkbox" checked={availabilityDays.includes(index)} onChange={() => setAvailabilityDays((current) => current.includes(index) ? current.filter((dayIndex) => dayIndex !== index) : [...current, index].sort())} className="size-4 accent-[#B85C38]" />
                  {day}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold text-[#111418]">Start date<input type="date" name="availability_start_date" defaultValue={selectedMenuItem?.availabilityStartDate ?? ""} className={fieldClassName} /></label>
              <label className="grid gap-2 text-sm font-semibold text-[#111418]">End date<input type="date" name="availability_end_date" defaultValue={selectedMenuItem?.availabilityEndDate ?? ""} className={fieldClassName} /></label>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-[22px] border border-[#F4C7C7] bg-[#FFF8F8] px-4 py-3 text-sm leading-6 text-[#8A1C1C]">
            {errorMessage}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-[22px] border border-[#CDE7D8] bg-[#F2FBF5] px-4 py-3 text-sm leading-6 text-[#166534]">
            {successMessage}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isPending}
          className="min-h-12 rounded-2xl bg-[#B85C38] px-5 py-3 text-sm font-bold text-white shadow-[0_8px_18px_rgba(184,92,56,0.22)] transition hover:bg-[#A74F30] hover:shadow-[0_10px_22px_rgba(184,92,56,0.28)] focus:outline-none focus:ring-4 focus:ring-[#B85C38]/20 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {getStatusLabel(phase, isEditing)}
        </button>

        {isPending ? (
          <p className="text-xs leading-5 text-[#6B7280]">
            {phase === "uploading"
              ? "The image is uploading now."
              : phase === "creating"
                ? "The sellable item record is being created now."
                : "The menu item changes are being saved now."}
          </p>
        ) : null}
      </form>
    </>
  );
}
