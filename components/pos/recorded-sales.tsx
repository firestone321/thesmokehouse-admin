"use client";
import type { SaleAttempt } from "@/lib/pos/sale-contract";
import { formatCurrency } from "@/lib/ops/utils";
export function RecordedSales({ attempts, busy, onCheckHardware, onReprint }: {
  attempts: SaleAttempt[]; busy: boolean;
  onCheckHardware: (key: string) => void; onReprint: (key: string) => void;
}) {
  if (!attempts.length) return null;
  const attention = attempts.some((attempt) => Object.values(attempt.hardware)
    .some((operation) => operation.state === "failed" || operation.state === "outcome_unknown"));
  return (
    <details className="surface-card rounded-2xl p-4">
      <summary className="cursor-pointer font-semibold">
        Recent recorded sales on this browser
        {attention ? <span className="ml-2 text-xs font-normal text-amber-800">Hardware needs attention</span> : null}
      </summary>
      <div className="mt-4 space-y-4">
        {attempts.map((attempt) => {
          const receipt = attempt.receipt;
          if (!receipt) return null;
          const key = attempt.payload.idempotencyKey;
          return (
            <article key={key} className="space-y-3 rounded-2xl border border-[#E4E7EB] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Sale {receipt.orderNumber}</h3>
                <span className="font-semibold">{formatCurrency(receipt.totalAmount)}</span>
              </div>
              <p className="text-sm">Payment recorded · {receipt.tenderType.replaceAll("_", " ")}</p>
              {receipt.changeGiven > 0 ? <p className="font-semibold">Change due: {formatCurrency(receipt.changeGiven)}</p> : null}
              {receipt.tenderType === "cash" && receipt.hardwareEnabled ? (
                <div className="space-y-2 text-sm">
                  <p>Receipt: {attempt.hardware.receipt.state.replaceAll("_", " ")}. {attempt.hardware.receipt.message}</p>
                  <p>Drawer: {attempt.hardware.drawer.state.replaceAll("_", " ")}. {attempt.hardware.drawer.message}</p>
                  <p className="text-xs text-[#6B7280]">Submission does not confirm physical output. Reprinting never opens the drawer.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => onCheckHardware(key)} className="rounded-xl border px-4 py-2">Check receipt and drawer status</button>
                    <button type="button" disabled={busy} onClick={() => onReprint(key)} className="rounded-xl border px-4 py-2">Reprint recorded receipt only</button>
                  </div>
                </div>
              ) : receipt.tenderType === "cash" ? (
                <button type="button" onClick={() => window.print()} className="rounded-xl border px-4 py-2 print:hidden">Print receipt</button>
              ) : <p className="text-sm">External terminal receipt applies. Local printer and cash drawer were not triggered.</p>}
            </article>
          );
        })}
      </div>
    </details>
  );
}
