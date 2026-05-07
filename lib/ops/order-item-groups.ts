export interface GroupableOrderItem {
  id: number;
  menuItemName: string;
  quantity: number;
  cartGroupId: string | null;
  cartItemRole: "main" | "addon" | null;
  cartSortOrder: number | null;
}

export interface OrderItemDisplayGroup<T extends GroupableOrderItem> {
  key: string;
  main: T;
  addons: T[];
}

export function groupOrderItemsForDisplay<T extends GroupableOrderItem>(items: T[]): OrderItemDisplayGroup<T>[] {
  const grouped = new Map<string, { main: T | null; addons: T[] }>();
  const groupedItemIds = new Set<number>();

  for (const item of items) {
    if (!item.cartGroupId || !item.cartItemRole) {
      continue;
    }

    const current = grouped.get(item.cartGroupId) ?? { main: null, addons: [] };
    if (item.cartItemRole === "main") {
      current.main = item;
    } else {
      current.addons.push(item);
    }
    grouped.set(item.cartGroupId, current);
  }

  const result: OrderItemDisplayGroup<T>[] = [];

  for (const item of items) {
    if (groupedItemIds.has(item.id)) {
      continue;
    }

    const candidateGroup = item.cartGroupId ? grouped.get(item.cartGroupId) : null;

    if (candidateGroup?.main?.id === item.id) {
      const addons = candidateGroup.addons.sort(
        (left, right) => (left.cartSortOrder ?? 0) - (right.cartSortOrder ?? 0) || left.id - right.id
      );
      groupedItemIds.add(item.id);
      addons.forEach((addon) => groupedItemIds.add(addon.id));
      result.push({
        key: item.cartGroupId ?? String(item.id),
        main: item,
        addons
      });
      continue;
    }

    result.push({
      key: String(item.id),
      main: item,
      addons: []
    });
    groupedItemIds.add(item.id);
  }

  return result;
}
