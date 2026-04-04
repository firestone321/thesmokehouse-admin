import { KitchenQueueEntry } from "@/lib/dashboard/types";

interface KitchenQueueCardProps {
  entries: KitchenQueueEntry[];
}

export function KitchenQueueCard({ entries }: KitchenQueueCardProps) {
  return (
    <section className="surface-card rounded-4xl p-5">
      <div className="border-b border-line/80 pb-4">
        <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Kitchen Smoking Queue</p>
        <h2 className="pt-2 text-xl font-semibold text-walnut">What the pit should be planning next</h2>
        <p className="pt-2 text-sm leading-6 text-stone-600">
          Derived from paid and smoking orders only. Pending orders are intentionally excluded until payment clears.
        </p>
      </div>

      <div className="space-y-3 pt-4">
        {entries.map((entry) => (
          <article key={entry.itemName} className="rounded-3xl bg-sand px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-ink">{entry.itemName}</h3>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-walnut">x{entry.quantity}</span>
            </div>
            <p className="pt-2 text-xs leading-5 text-stone-500">Orders: {entry.sourceOrderNumbers.join(", ")}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
