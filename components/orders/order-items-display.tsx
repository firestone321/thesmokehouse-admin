import { groupOrderItemsForDisplay } from "@/lib/ops/order-item-groups";
import type { OrderItemRecord } from "@/lib/ops/types";
import { formatCurrency } from "@/lib/ops/utils";

function isGroupedMeal(group: ReturnType<typeof groupOrderItemsForDisplay<OrderItemRecord>>[number]) {
  return Boolean(group.main.cartGroupId && group.main.cartItemRole === "main");
}

function getGroupSubtotal(group: ReturnType<typeof groupOrderItemsForDisplay<OrderItemRecord>>[number]) {
  return group.main.lineTotal + group.addons.reduce((sum, addon) => sum + addon.lineTotal, 0);
}

function getItemBadge(item: OrderItemRecord, isMain: boolean) {
  if (isMain) {
    return "MAIN";
  }

  return item.menuCategoryName?.toLowerCase().includes("drink") ? "DRINK" : "SIDE";
}

function OrderItemBadge({ label }: { label: string }) {
  const classes =
    label === "MAIN"
      ? "border-[#C9D3DF] bg-[#EEF3F8] text-[#304156]"
      : label === "DRINK"
        ? "border-[#D6E2DD] bg-[#F0F7F3] text-[#3E6251]"
        : "border-[#E2D7C8] bg-[#F8F1E8] text-[#735739]";

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${classes}`}>
      {label}
    </span>
  );
}

type OrderItemsSummaryVariant = "default" | "orders-list";

export function OrderItemsSummary({
  items,
  fallback,
  variant = "default"
}: {
  items: OrderItemRecord[];
  fallback: string;
  variant?: OrderItemsSummaryVariant;
}) {
  const groups = groupOrderItemsForDisplay(items);

  if (groups.length === 0) {
    return <p className="text-sm leading-6 text-[#6B7280]">{fallback}</p>;
  }

  if (variant === "orders-list") {
    return (
      <div className="w-full max-w-xl space-y-3 text-sm leading-5 text-[#5D6673]">
        {groups.map((group) => {
          const grouped = isGroupedMeal(group);

          if (!grouped) {
            return (
              <div key={group.key}>
                <p>
                  {group.main.menuItemName} x{group.main.quantity}
                </p>
              </div>
            );
          }

          return (
            <div key={group.key} className="space-y-1">
              <p className="break-words text-[15px] font-black leading-5 text-[#111418]">
                {group.main.menuItemName} x{group.main.quantity}
              </p>
              {group.addons.length > 0 ? (
                <div className="space-y-1 border-l-2 border-[#D7DDE4] pl-3 text-[13px] leading-5 text-[#667085]">
                  {group.addons.map((addon) => (
                    <p key={addon.id} className="break-words">
                      <span className="text-[#98A2B3]">- </span>
                      <span className="font-semibold text-[#475467]">{addon.menuItemName}</span>{" "}
                      <span className="font-medium text-[#7B8490]">x{addon.quantity}</span>
                    </p>
                  ))}
                  <p className="pt-0.5 text-xs font-bold uppercase tracking-[0.12em] text-[#6B7280]">
                    Group subtotal: <span className="font-black tracking-normal text-[#111418]">{formatCurrency(getGroupSubtotal(group))}</span>
                  </p>
                </div>
              ) : (
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#6B7280]">
                  Group subtotal: <span className="font-black tracking-normal text-[#111418]">{formatCurrency(getGroupSubtotal(group))}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl space-y-2.5 text-sm leading-5 text-[#6B7280]">
      {groups.map((group) => {
        const grouped = isGroupedMeal(group);

        if (!grouped) {
          return (
            <div key={group.key}>
              <p>
                {group.main.menuItemName} x{group.main.quantity}
              </p>
            </div>
          );
        }

        return (
          <div key={group.key} className="w-full rounded-xl border border-[#E1E6ED] bg-[#F8FAFB] px-3.5 py-3 shadow-[0_6px_14px_rgba(15,23,42,0.03)]">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="min-w-0 break-words text-base font-black leading-5 text-[#111418]">{group.main.menuItemName}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-[#6B7280]">x{group.main.quantity}</p>
              </div>
              <div className="pt-0.5">
                <OrderItemBadge label={getItemBadge(group.main, true)} />
              </div>
            </div>
            {group.addons.length > 0 ? (
              <div className="mt-2.5 space-y-1.5 border-l-2 border-[#D7DDE4] pl-3">
                {group.addons.map((addon) => (
                  <div key={addon.id} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-[#E8ECF1] bg-white/80 px-2.5 py-2 text-[13px] leading-5 text-[#667085]">
                    <div className="min-w-0">
                      <p className="break-words font-bold text-[#3B4654]">{addon.menuItemName}</p>
                      <p className="mt-0.5 text-xs font-semibold text-[#7B8490]">x{addon.quantity}</p>
                    </div>
                    <div className="pt-0.5">
                      <OrderItemBadge label={getItemBadge(addon, false)} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {grouped ? (
              <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-[#E1E6ED] pt-2 text-xs font-bold uppercase tracking-[0.12em] text-[#6B7280]">
                <span>Group subtotal</span>
                <span className="shrink-0 text-sm font-black tracking-normal text-[#111418]">{formatCurrency(getGroupSubtotal(group))}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function OrderItemsDetail({ items }: { items: OrderItemRecord[] }) {
  const groups = groupOrderItemsForDisplay(items);

  return (
    <div className="mt-4 space-y-3">
      {groups.map((group) => {
        const grouped = isGroupedMeal(group);

        return (
          <article key={group.key} className="rounded-[18px] bg-[#F8FAFB] px-4 py-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="min-w-0 break-words text-base font-black leading-5 text-[#111418]">{group.main.menuItemName}</h3>
                  {grouped ? <OrderItemBadge label={getItemBadge(group.main, true)} /> : null}
                </div>
                <p className="mt-1 text-sm font-semibold text-[#596273]">Qty {group.main.quantity}</p>
              </div>
              <div className="text-right text-sm text-[#6B7280]">
                <p>{formatCurrency(group.main.unitPrice)} each</p>
                <p className="mt-1 text-base font-black text-[#111418]">{formatCurrency(group.main.lineTotal)}</p>
              </div>
            </div>

            {group.addons.length > 0 ? (
              <div className="mt-2.5 space-y-1.5 border-l-2 border-[#D7DDE4] pl-3">
                {group.addons.map((addon) => (
                  <div key={addon.id} className="rounded-[14px] border border-[#E4E7EB] bg-white/75 px-2.5 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h4 className="min-w-0 break-words text-[13px] font-bold leading-4 text-[#303946]">{addon.menuItemName}</h4>
                          <OrderItemBadge label={getItemBadge(addon, false)} />
                        </div>
                        <p className="mt-0.5 text-xs font-medium text-[#7B8490]">Qty {addon.quantity}</p>
                      </div>
                      <div className="text-right text-xs text-[#7B8490]">
                        <p>{formatCurrency(addon.unitPrice)} each</p>
                        <p className="mt-0.5 font-semibold text-[#303946]">{formatCurrency(addon.lineTotal)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {grouped ? (
              <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-[#E4E7EB] pt-2 text-sm">
                <span className="font-bold uppercase tracking-[0.12em] text-[#6B7280]">Group subtotal</span>
                <span className="font-black text-[#111418]">{formatCurrency(getGroupSubtotal(group))}</span>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
