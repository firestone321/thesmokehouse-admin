"use client";

import { useMemo, useState } from "react";
import { PosPrintStationToggle } from "@/components/pwa/pos-print-station-toggle";
import { UgxAmountInput } from "@/components/ugx-amount-input";
import type { PosMenuItem, PosTenderType } from "@/lib/pos/types";

type BasketLine = PosMenuItem & { quantity: number };
type Receipt = {
  orderId: number;
  orderNumber: string;
  status: string;
  totalAmount: number;
  tenderType: string;
  amountReceived: number;
  changeGiven: number;
  hardware: HardwareInstructions | HardwareUnavailable | HardwareExternalTerminal | null;
};

type HardwareInstructions = {
  status: "ready";
  bridgeUrl: string;
  receipt: {
    saleId: string;
    date: string;
    items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
    subtotal: number;
    total: number;
    paymentMethod: "cash" | "mobile_money" | "card";
  };
  printAuthorization: string;
  drawerAuthorization?: string;
};

type HardwareUnavailable = { status: "unavailable"; message: string };
type HardwareExternalTerminal = { status: "external_terminal"; message: string };

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0
  }).format(value);
}

function tenderLabel(tender: PosTenderType) {
  return tender === "mobile_money" ? "Mobile money" : tender.charAt(0).toUpperCase() + tender.slice(1);
}

const categoryCardColors = [
  "border-[#F2D7B6] bg-[#FFF9F0] hover:border-[#D38B2A]",
  "border-[#C8E3D0] bg-[#F2FBF5] hover:border-[#2E7D4A]",
  "border-[#CEDAF6] bg-[#F3F6FF] hover:border-[#4267B2]",
  "border-[#E5CDEC] bg-[#FCF5FD] hover:border-[#9C4FA8]"
];

const categoryIcons: Record<string, string> = {
  platters: "♨️",
  goat: "🐐",
  beef: "🥩",
  accompaniments: "🧺",
  sides: "🍟",
  chicken: "🍗",
  drinks: "🥤"
};

function categoryIcon(category: string) {
  return categoryIcons[category.trim().toLowerCase()] ?? "🍽️";
}

export function PosSaleWorkspace({
  cashierEmail,
  menuItems,
  canRecordSales
}: {
  cashierEmail: string | null;
  menuItems: PosMenuItem[];
  canRecordSales: boolean;
}) {
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [tenderType, setTenderType] = useState<PosTenderType>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [hardwareNotice, setHardwareNotice] = useState<string | null>(null);

  const total = useMemo(
    () => basket.reduce((sum, item) => sum + item.basePrice * item.quantity, 0),
    [basket]
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = menuItems.filter(
    (item) =>
      (selectedCategory === "All" || item.categoryName === selectedCategory) &&
      (!normalizedQuery || `${item.name} ${item.categoryName}`.toLowerCase().includes(normalizedQuery))
  );
  const allCategories = Array.from(new Set(menuItems.map((item) => item.categoryName)));
  const categories = Array.from(new Set(visibleItems.map((item) => item.categoryName)));
  const change = tenderType === "cash" && cashReceived !== "" ? Math.max(0, Number(cashReceived) - total) : 0;

  function addItem(item: PosMenuItem) {
    setReceipt(null);
    setHardwareNotice(null);
    setError(null);
    setIdempotencyKey(null);
    setBasket((current) => {
      const existing = current.find((line) => line.id === item.id);
      if (!existing) return [...current, { ...item, quantity: 1 }];
      if (existing.quantity >= Math.min(20, item.availableQuantity)) return current;
      return current.map((line) => (line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line));
    });
  }

  function changeQuantity(menuItemId: number, nextQuantity: number) {
    setReceipt(null);
    setHardwareNotice(null);
    setError(null);
    setIdempotencyKey(null);
    setBasket((current) =>
      current.flatMap((line) => {
        if (line.id !== menuItemId) return [line];
        if (nextQuantity <= 0) return [];
        return [{ ...line, quantity: Math.min(nextQuantity, line.availableQuantity, 20) }];
      })
    );
  }

  async function takePayment() {
    setError(null);
    setReceipt(null);
    setHardwareNotice(null);
    if (!canRecordSales) {
      setError("POS view only. Ask a cashier, manager, or admin to record a sale.");
      return;
    }
    if (basket.length === 0) {
      setError("Add at least one available item before taking payment.");
      return;
    }

    const amountReceived = tenderType === "cash" ? Number(cashReceived) : total;
    if (!Number.isInteger(amountReceived) || amountReceived < total) {
      setError("Enter the cash received. It must cover the sale total.");
      return;
    }
    if (tenderType !== "cash" && !paymentReference.trim()) {
      setError(`Enter the ${tenderLabel(tenderType).toLowerCase()} confirmation or terminal reference.`);
      return;
    }

    const requestKey = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(requestKey);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/admin/pos/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: requestKey,
          tenderType,
          amountReceived,
          paymentReference: paymentReference.trim() || undefined,
          items: basket.map((line) => ({ menuItemId: line.id, quantity: line.quantity }))
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "Unable to create the POS sale.");
      }

      const completedReceipt = result.data as Receipt;
      setReceipt(completedReceipt);
      if (completedReceipt.hardware?.status === "ready") {
        void sendReceiptToLocalBridge(completedReceipt.hardware);
      } else if (completedReceipt.hardware?.status === "unavailable" || completedReceipt.hardware?.status === "external_terminal") {
        setHardwareNotice(completedReceipt.hardware.message);
      }
      setBasket([]);
      setCashReceived("");
      setPaymentReference("");
      setIdempotencyKey(null);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Unable to create the POS sale.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function sendReceiptToLocalBridge(hardware: HardwareInstructions) {
    const notices: string[] = [];
    try {
      const response = await fetch(`${hardware.bridgeUrl}/receipt/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${hardware.printAuthorization}` },
        body: JSON.stringify(hardware.receipt)
      });
      if (!response.ok) throw new Error("Receipt printer rejected the request.");
      notices.push("Receipt sent to printer.");
    } catch {
      notices.push("SALE COMPLETE — RECEIPT PRINT FAILED");
    }

    if (hardware.drawerAuthorization) {
      try {
        const response = await fetch(`${hardware.bridgeUrl}/drawer/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${hardware.drawerAuthorization}` },
          body: JSON.stringify({ saleId: hardware.receipt.saleId })
        });
        if (!response.ok) throw new Error("Cash drawer rejected the request.");
        notices.push("Cash drawer opened.");
      } catch {
        notices.push("SALE COMPLETE — DRAWER OPEN FAILED");
      }
    }
    setHardwareNotice(notices.join(" "));
  }

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Walk-in POS</p>
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Counter sales</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Every sale reserves only the live stock remaining after paid online orders. Prices and stock are checked again when payment is taken.
            </p>
          </div>
          <div className="rounded-[20px] bg-[#F8FAFB] px-4 py-3 text-sm text-[#4B5563]">
            Signed in as <span className="font-semibold text-[#111418]">{cashierEmail ?? "POS cashier"}</span>
          </div>
        </div>
        <div className="mt-4 max-w-2xl"><PosPrintStationToggle /></div>
      </section>

      {error ? <section className="rounded-[22px] border border-[#F4C7C7] bg-[#FFF8F8] px-4 py-3 text-sm text-[#9F2D2D]">{error}</section> : null}

      {receipt ? (
        <section className="rounded-[28px] border border-[#B9DFC6] bg-[#F2FBF5] p-5 print:border-0 print:bg-white">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#287241]">Payment recorded</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Sale {receipt.orderNumber}</h2>
              <p className="mt-1 text-sm text-[#4B5563]">Paid by {receipt.tenderType.replace("_", " ")} · sent to the kitchen queue.</p>
            </div>
            <p className="text-xl font-semibold">{formatCurrency(receipt.totalAmount)}</p>
          </div>
          {receipt.changeGiven > 0 ? <p className="mt-3 text-sm font-semibold">Change due: {formatCurrency(receipt.changeGiven)}</p> : null}
          {hardwareNotice ? <p className="mt-3 text-sm font-semibold text-[#166534]">{hardwareNotice}</p> : null}
          {!receipt.hardware ? <button type="button" onClick={() => window.print()} className="mt-4 rounded-2xl border border-[#A8D3B5] bg-white px-4 py-2.5 text-sm font-semibold text-[#166534] print:hidden">
            Print receipt
          </button> : null}
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="surface-card rounded-[32px] p-5">
          <div className="flex flex-col gap-3 border-b border-[#EEF2F6] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Available now</p>
              <h2 className="mt-2 text-xl font-semibold">Menu</h2>
            </div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item or category" className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm" />
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {["All", ...allCategories].map((category) => (
              <button key={category} type="button" onClick={() => setSelectedCategory(category)} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition ${selectedCategory === category ? "border-[#C85255] bg-[#FBECEE] text-[#B13C40] shadow-sm" : "border-[#E4E7EB] bg-[#F8FAFB] text-[#4B5563] hover:bg-white"}`}>
                <span className="mr-2">{category === "All" ? "✨" : categoryIcon(category)}</span>{category}
              </button>
            ))}
          </div>
          <div className="mt-2 space-y-5">
            {categories.map((category) => (
              <div key={category}>
                <h3 className="text-base font-bold text-[#4B5563]"><span className="mr-2">{categoryIcon(category)}</span>{category}</h3>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {visibleItems.filter((item) => item.categoryName === category).map((item) => (
                    <button key={item.id} type="button" onClick={() => addItem(item)} className={`overflow-hidden rounded-[22px] border text-left transition focus:outline-none focus:ring-4 focus:ring-[#111418]/15 ${categoryCardColors[categories.indexOf(category) % categoryCardColors.length]}`}>
                      <div className="flex gap-3 p-3">
                        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[18px] bg-white/70">
                          {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-2xl">🍽️</div>}
                        </div>
                        <div className="min-w-0 flex-1 py-1">
                          <div className="flex items-start justify-between gap-2"><span className="text-base font-bold leading-5">{item.name}</span><span className="shrink-0 rounded-full bg-white/80 px-2 py-1 text-[11px] font-bold text-[#287241]">{item.availableQuantity} left</span></div>
                          <p className="mt-2 text-xs text-[#5C6470]">{item.portionLabel ?? item.description ?? "Sellable portion"}</p>
                          <p className="mt-3 text-base font-bold">{formatCurrency(item.basePrice)}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {visibleItems.length === 0 ? <p className="rounded-[20px] bg-[#F8FAFB] px-4 py-5 text-sm text-[#6B7280]">No sellable stock matches that search.</p> : null}
          </div>
        </section>

        <aside className="surface-card rounded-[32px] p-5 xl:sticky xl:top-5 xl:self-start">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Sale basket</p>
          <h2 className="mt-2 text-xl font-semibold">Take payment</h2>
          <div className="mt-4 space-y-3 border-y border-[#EEF2F6] py-4">
            {basket.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2"><div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-[#F8FAFB]">{line.imageUrl ? <img src={line.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-lg">🍽️</div>}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{line.name}</p><p className="text-xs text-[#6B7280]">{formatCurrency(line.basePrice)} each</p></div></div>
                <div className="flex items-center gap-2"><button type="button" onClick={() => changeQuantity(line.id, line.quantity - 1)} className="h-8 w-8 rounded-full border border-[#D7DDE4] font-semibold">−</button><span className="w-5 text-center text-sm font-semibold">{line.quantity}</span><button type="button" onClick={() => changeQuantity(line.id, line.quantity + 1)} className="h-8 w-8 rounded-full border border-[#D7DDE4] font-semibold">+</button></div>
              </div>
            ))}
            {basket.length === 0 ? <p className="text-sm text-[#6B7280]">Tap an available item to add it.</p> : null}
          </div>
          <div className="mt-4 flex items-end justify-between"><span className="text-sm text-[#6B7280]">Total</span><span className="text-2xl font-semibold">{formatCurrency(total)}</span></div>
          <fieldset className="mt-5"><legend className="text-sm font-semibold">Payment method</legend><div className="mt-2 grid grid-cols-3 gap-2">{(["cash", "mobile_money", "card"] as const).map((method) => <button key={method} type="button" onClick={() => { setTenderType(method); setError(null); }} className={`min-h-20 rounded-2xl border px-2 text-sm font-bold transition ${tenderType === method ? method === "cash" ? "border-[#287241] bg-[#EAF8EF] text-[#166534] ring-2 ring-[#287241]/20" : method === "mobile_money" ? "border-[#6D4CC7] bg-[#F2EEFF] text-[#5637AC] ring-2 ring-[#6D4CC7]/20" : "border-[#286AA6] bg-[#EDF7FF] text-[#1D5B91] ring-2 ring-[#286AA6]/20" : "border-[#D7DDE4] bg-white text-[#4B5563]"}`}>{method === "cash" ? "💵" : method === "mobile_money" ? "📱" : "💳"}<span className="mt-1 block text-xs">{tenderLabel(method)}</span></button>)}</div></fieldset>
          {tenderType === "cash" ? <label className="mt-4 grid gap-2 text-sm font-semibold">Cash received <span className="text-xs font-normal text-[#6B7280]">Type numbers normally; commas are added automatically.</span><div className="relative"><span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm font-bold text-[#4B5563]">UGX</span><UgxAmountInput value={cashReceived} onValueChange={setCashReceived} placeholder="0" className="w-full rounded-2xl border-2 border-[#287241] bg-[#F2FBF5] py-3 pl-14 pr-4 text-lg font-bold" aria-label="Cash received in Ugandan shillings" /></div></label> : <label className="mt-4 grid gap-2 text-sm font-semibold">Visa POS terminal reference<span className="text-xs font-normal text-[#6B7280]">Complete the {tenderLabel(tenderType).toLowerCase()} payment on the terminal, then enter its reference.</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={120} placeholder="Terminal transaction reference" className="rounded-2xl border-2 border-[#4267B2] bg-[#F3F6FF] px-4 py-3 text-sm font-normal" /></label>}
          {tenderType === "cash" && cashReceived !== "" ? <p className={`mt-2 rounded-xl px-3 py-2 text-sm font-semibold ${Number(cashReceived) >= total ? "bg-[#EAF8EF] text-[#166534]" : "bg-[#FFF4E5] text-[#B45309]"}`}>{Number(cashReceived) >= total ? `Change: ${formatCurrency(change)}` : `Still needed: ${formatCurrency(total - Number(cashReceived))}`}</p> : null}
          {!canRecordSales ? <p className="mt-5 rounded-2xl bg-[#F3F4F6] px-4 py-3 text-sm font-semibold text-[#6B7280]">POS view only. A cashier, manager, or admin records sales.</p> : null}
          <button type="button" disabled={!canRecordSales || isSubmitting || basket.length === 0} onClick={takePayment} className="mt-5 w-full rounded-2xl bg-[#166534] px-4 py-4 text-base font-bold text-white shadow-[0_10px_22px_rgba(22,101,52,0.22)] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]">{!canRecordSales ? "View only" : isSubmitting ? "Recording sale…" : "Take payment and create sale"}</button>
          <p className="mt-3 text-xs leading-5 text-[#6B7280]">One payment method per sale for now. Split payments remain pending proprietor approval.</p>
        </aside>
      </div>
    </div>
  );
}
