type BridgeItem = { menuItemId: number; name: string; unitPrice: number; available: number };
type BasketItem = { menuItemId: number; quantity: number };
type CashInput = { transactionId: string; catalogVersion: string; expectedTotal: number; amountReceived: number; items: BasketItem[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Construct input only from a fresh authenticated bridge catalog. The bridge revalidates everything. */
export function buildOfflineCashInput(options: {
  transactionId: string; catalogVersion: string; catalog: BridgeItem[]; items: BasketItem[];
  amountReceived: number; tenderType: string; unresolvedCloudAttempt: boolean;
}): CashInput {
  if (options.unresolvedCloudAttempt) throw new Error("Resolve the original cloud sale before recording another sale.");
  if (options.tenderType !== "cash") throw new Error("Offline sales accept cash only.");
  if (!UUID.test(options.transactionId) || !UUID.test(options.catalogVersion)) throw new Error("Invalid sale or catalog identity.");
  if (!Array.isArray(options.catalog) || options.catalog.length > 100 || !Array.isArray(options.items) || !options.items.length || options.items.length > 100) throw new Error("Invalid offline basket.");
  const catalog = new Map<number, BridgeItem>();
  for (const item of options.catalog) {
    if (!Number.isSafeInteger(item.menuItemId) || item.menuItemId <= 0 || catalog.has(item.menuItemId) ||
        !Number.isSafeInteger(item.unitPrice) || item.unitPrice <= 0 || !Number.isSafeInteger(item.available) || item.available < 0) throw new Error("Invalid authorized catalog.");
    catalog.set(item.menuItemId, item);
  }
  const seen = new Set<number>(); let total = 0;
  const items = options.items.map(line => {
    const item = catalog.get(line.menuItemId);
    if (!item || seen.has(line.menuItemId) || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 20 || line.quantity > item.available) throw new Error("Item is unavailable in the funded allocation.");
    seen.add(line.menuItemId); total += item.unitPrice * line.quantity;
    return { menuItemId:line.menuItemId, quantity:line.quantity };
  });
  if (!Number.isSafeInteger(total) || total <= 0 || total > 100000000 || !Number.isSafeInteger(options.amountReceived) || options.amountReceived < total || options.amountReceived > 100000000) throw new Error("Cash amount does not match the authorized sale.");
  return {transactionId:options.transactionId, catalogVersion:options.catalogVersion, expectedTotal:total, amountReceived:options.amountReceived, items};
}
