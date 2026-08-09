import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import type { PosMenuItem } from "@/lib/pos/types";

function ugandaServiceDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function toNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export async function getPosMenuItems(): Promise<PosMenuItem[]> {
  noStore();

  const { data, error } = await createAdminSupabaseClient().rpc("get_storefront_menu", {
    p_service_date: ugandaServiceDate()
  });

  if (error) {
    throw new Error(`Unable to load the POS menu: ${error.message}`);
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((item): PosMenuItem => ({
      id: toNumber(item.id),
      name: String(item.name ?? "Unnamed item"),
      description: typeof item.description === "string" ? item.description : null,
      imageUrl: typeof item.image_url === "string" ? item.image_url : null,
      basePrice: toNumber(item.base_price),
      categoryName: String(item.category_name ?? "Other"),
      portionLabel: typeof item.portion_label === "string" ? item.portion_label : null,
      availableQuantity: Math.max(0, toNumber(item.available_quantity))
    }))
    .filter((item) => item.availableQuantity > 0);
}
