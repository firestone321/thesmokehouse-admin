"use client";

export function PrintReceiptButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-xl border px-3 py-2 text-sm font-semibold print:hidden">Print receipt</button>;
}