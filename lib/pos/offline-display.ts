import type { PosMenuItem } from "./types";

type DisplayItem = Pick<PosMenuItem, "id" | "categoryName" | "imageUrl" | "description" | "portionLabel">;
type BridgeItem = { menuItemId: number; name: string; unitPrice: number; available: number };
const MAX_ITEMS = 100;
const MAX_TEXT = 160;
const KEY_PREFIX = "smokehouse-pos-display-v1:";
function text(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_TEXT ? value : null;
}
function image(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try { const u = new URL(value, "https://display.invalid"); return u.protocol === "https:" || (value.startsWith("/") && !value.startsWith("//")) ? value : null; }
  catch { return null; }
}
export function displaySnapshot(items: PosMenuItem[]): DisplayItem[] {
  return items.slice(0, MAX_ITEMS).filter(item => Number.isSafeInteger(item.id) && item.id > 0).map(item => ({
    id: item.id, categoryName: text(item.categoryName) || "Other", imageUrl: image(item.imageUrl),
    description: text(item.description), portionLabel: text(item.portionLabel)
  }));
}
export function saveDisplaySnapshot(storage: Storage, cashierId: string, items: PosMenuItem[]): void {
  storage.setItem(KEY_PREFIX + cashierId, JSON.stringify({ version: 1, items: displaySnapshot(items) }));
}
export function loadDisplaySnapshot(storage: Storage, cashierId: string): DisplayItem[] {
  try {
    const raw = storage.getItem(KEY_PREFIX + cashierId); if (!raw || raw.length > 350000) return [];
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("items" in value) || !Array.isArray(value.items) || value.items.length > MAX_ITEMS) return [];
    return displaySnapshot(value.items as PosMenuItem[]);
  } catch { return []; }
}
// Only bridge items become sellable. Snapshot data never supplies name, price or stock.
export function reconcileOfflineDisplay(bridge: BridgeItem[], saved: DisplayItem[]): PosMenuItem[] {
  if (!Array.isArray(bridge) || bridge.length > MAX_ITEMS) throw new Error("Invalid bridge catalog");
  const seen = new Set<number>(), metadata = new Map(saved.map(item => [item.id, item]));
  return bridge.map(item => {
    if (!Number.isSafeInteger(item.menuItemId) || item.menuItemId <= 0 || seen.has(item.menuItemId) ||
        typeof item.name !== "string" || !item.name || item.name.length > 120 ||
        !Number.isSafeInteger(item.unitPrice) || item.unitPrice <= 0 ||
        !Number.isSafeInteger(item.available) || item.available < 0) throw new Error("Invalid bridge catalog");
    seen.add(item.menuItemId); const display = metadata.get(item.menuItemId);
    return { id:item.menuItemId, name:item.name, basePrice:item.unitPrice, availableQuantity:item.available,
      categoryName:display?.categoryName || "Other", imageUrl:display?.imageUrl || null,
      description:display?.description || null, portionLabel:display?.portionLabel || null };
  });
}
