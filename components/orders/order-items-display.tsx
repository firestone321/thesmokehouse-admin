import { groupOrderItemsForDisplay } from "@/lib/ops/order-item-groups";
import type { OrderItemRecord } from "@/lib/ops/types";
import { formatCurrency } from "@/lib/ops/utils";

export function OrderItemsSummary({ items, fallback }: { items: OrderItemRecord[]; fallback: string }) {
  const groups = groupOrderItemsForDisplay(items);

  if (groups.length === 0) {
    return <p className="text-sm leading-6 text-[#6B7280]">{fallback}</p>;
  }

  return (
    <div className="space-y-1 text-sm leading-6 text-[#6B7280]">
      {groups.map((group) => (
        <div key={group.key}>
          <p>
            {group.main.menuItemName} x{group.main.quantity}
          </p>
          {group.addons.length > 0 ? (
            <div className="border-l border-[#D7DDE4] pl-3">
              {group.addons.map((addon) => (
                <p key={addon.id}>
                  - {addon.menuItemName} x{addon.quantity}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function OrderItemsDetail({ items }: { items: OrderItemRecord[] }) {
  const groups = groupOrderItemsForDisplay(items);

  return (
    <div className="mt-4 space-y-3">
      {groups.map((group) => (
        <article key={group.key} className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[#111418]">{group.main.menuItemName}</h3>
              <p className="mt-1 text-sm text-[#6B7280]">Qty {group.main.quantity}</p>
            </div>
            <div className="text-right text-sm text-[#6B7280]">
              <p>{formatCurrency(group.main.unitPrice)} each</p>
              <p className="mt-1 font-semibold text-[#111418]">{formatCurrency(group.main.lineTotal)}</p>
            </div>
          </div>

          {group.addons.length > 0 ? (
            <div className="mt-3 space-y-2 border-l-2 border-[#D7DDE4] pl-3">
              {group.addons.map((addon) => (
                <div key={addon.id} className="rounded-[18px] border border-[#E4E7EB] bg-white px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-[#111418]">- {addon.menuItemName}</h4>
                      <p className="mt-1 text-sm text-[#6B7280]">Qty {addon.quantity}</p>
                    </div>
                    <div className="text-right text-sm text-[#6B7280]">
                      <p>{formatCurrency(addon.unitPrice)} each</p>
                      <p className="mt-1 font-semibold text-[#111418]">{formatCurrency(addon.lineTotal)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
