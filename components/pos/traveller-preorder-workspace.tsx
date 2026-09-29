"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { PosMenuItem, PosTenderType } from "@/lib/pos/types";

type Preorder = {
  orderId: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  promisedAt: string;
  orderMode: string;
  paymentTiming: string;
  busReference: string | null;
  checkedInAt: string | null;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
};

type ReceiptHardware = {
  status: "ready";
  bridgeUrl: string;
  receipt: { saleId: string; date: string; items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
    subtotal: number; total: number; paymentMethod: "cash" | "mobile_money" | "card" };
  printAuthorization: string;
  drawerAuthorization?: string;
};
type HardwareResult = ReceiptHardware | { status: "unavailable" | "external_terminal"; message: string } | null;

async function sendTravellerReceipt(hardware: HardwareResult): Promise<string> {
  if (!hardware) return "Open the individual receipt for a browser copy.";
  if (hardware.status !== "ready") return hardware.message;
  const notices: string[] = [];
  try {
    const response = await fetch(`${hardware.bridgeUrl}/receipt/print`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${hardware.printAuthorization}` },
      body: JSON.stringify(hardware.receipt)
    });
    if (!response.ok) throw new Error("Receipt printer rejected the request.");
    notices.push("Receipt sent to printer.");
  } catch { notices.push("Sale complete; receipt print failed."); }
  if (hardware.drawerAuthorization) {
    try {
      const response = await fetch(`${hardware.bridgeUrl}/drawer/open`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${hardware.drawerAuthorization}` },
        body: JSON.stringify({ saleId: hardware.receipt.saleId })
      });
      if (!response.ok) throw new Error("Cash drawer rejected the request.");
      notices.push("Cash drawer opened.");
    } catch { notices.push("Sale complete; cash drawer did not open."); }
  }
  return notices.join(" ");
}
type OrderMode = "combined" | "individual";
type PaymentTiming = "booking" | "arrival";

function money(amount: number) {
  return new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(amount);
}

function arrivalLabel(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    timeZone: "Africa/Kampala", dateStyle: "medium", timeStyle: "short"
  }).format(new Date(value));
}

const fieldClass = "w-full rounded-xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]";

function ArrivalCard({ preorder }: { preorder: Preorder }) {
  const router = useRouter();
  const [tenderType, setTenderType] = useState<PosTenderType>("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const needsArrival = preorder.status === "new";

  async function submitArrival() {
    setError(null);
    setResult(null);
    const pay = preorder.paymentStatus !== "paid";
    const received = tenderType === "cash" ? Number(amountReceived) : preorder.totalAmount;
    if (pay && (!Number.isInteger(received) || received < preorder.totalAmount)) {
      setError("Cash received must cover the order total.");
      return;
    }
    if (pay && tenderType !== "cash" && !/^(?:\d{4}|\d{11})$/.test(paymentReference.trim())) {
      setError("Enter the terminal reference or its last four digits.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/pos/travellers/preorders/${preorder.orderId}/arrival`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pay ? {
          action: "pay", tenderType, amountReceived: received,
          paymentReference: paymentReference.trim() || undefined
        } : { action: "check_in" })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "Unable to check in the preorder.");
      setResult(pay
        ? `Payment recorded. Change: ${money(Number(payload.data.changeGiven))}. Sent to kitchen.`
        : "Checked in and sent to kitchen.");
      if (pay) {
        void sendTravellerReceipt(payload.data.hardware as HardwareResult).then((notice) =>
          setResult((current) => `${current ?? ""} ${notice}`));
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to check in the preorder.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelUnpaid() {
    if (!window.confirm(`Cancel unpaid preorder ${preorder.orderNumber} and release its held stock?`)) return;
    setError(null); setResult(null); setBusy(true);
    try {
      const response = await fetch(`/api/admin/pos/travellers/preorders/${preorder.orderId}/cancel`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "Unable to cancel preorder.");
      setResult("Unpaid preorder cancelled; held stock released.");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to cancel preorder."); }
    finally { setBusy(false); }
  }
  return (
    <article className="rounded-[24px] border border-[#E5E1DC] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{preorder.orderNumber} · {preorder.customerName}</h3>
          <p className="mt-1 text-sm text-[#5F6670]">{preorder.customerPhone} · {preorder.orderMode === "combined" ? "Combined bus order" : "Passenger order"}{preorder.busReference ? ` · Bus ${preorder.busReference}` : ""}</p>
          <p className="mt-1 text-sm text-[#5F6670]">Arrival: {arrivalLabel(preorder.promisedAt)}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold">{money(preorder.totalAmount)}</p>
          <p className="text-xs text-[#5F6670]">{preorder.paymentStatus === "paid" ? "Paid" : "Payment due"} · {preorder.status.replace("_", " ")}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-sm text-[#4B5563]">
        {preorder.items.map((item, index) => <li key={`${item.name}-${index}`}>{item.quantity} × {item.name}</li>)}
      </ul>
      {needsArrival ? (
        <div className="mt-4 border-t border-[#E5E1DC] pt-4">
          {preorder.paymentStatus !== "paid" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold">Tender
                <select className={fieldClass + " mt-1"} value={tenderType} onChange={(event) => setTenderType(event.target.value as PosTenderType)}>
                  <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="card">Card</option>
                </select>
              </label>
              {tenderType === "cash" ? <label className="text-xs font-semibold">Cash received
                <input className={fieldClass + " mt-1"} type="number" min={preorder.totalAmount} step="1" value={amountReceived} onChange={(event) => setAmountReceived(event.target.value)} />
              </label> : <label className="text-xs font-semibold">Terminal reference
                <input className={fieldClass + " mt-1"} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Last 4 or full 11 digits" />
              </label>}
            </div>
          ) : null}
          <button type="button" disabled={busy} onClick={submitArrival} className="mt-3 rounded-xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Working..." : preorder.paymentStatus === "paid" ? "Check in and send to kitchen" : "Take payment and send to kitchen"}
          </button>
          {preorder.paymentStatus !== "paid" ? <button type="button" disabled={busy} onClick={cancelUnpaid} className="ml-2 mt-3 rounded-xl border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-60">Cancel unpaid preorder</button> : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-[#9F2D2D]">{error}</p> : null}
      {result ? <div className="mt-3 flex items-center gap-3 text-sm text-[#166534]"><p>{result}</p><a href={`/pos/travellers/receipts/${preorder.orderId}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border px-2 py-1">Open receipt</a></div> : null}
    </article>
  );
}

export function TravellerPreorderWorkspace({ foodItems, drinkItems, preorders }: { foodItems: PosMenuItem[]; drinkItems: PosMenuItem[]; preorders: Preorder[] }) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [orderMode, setOrderMode] = useState<OrderMode>("combined");
  const [saleMode, setSaleMode] = useState<"preorder" | "counter">("preorder");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [busReference, setBusReference] = useState("");
  const [arrivalAt, setArrivalAt] = useState("");
  const [paymentTiming, setPaymentTiming] = useState<PaymentTiming>("arrival");
  const [tenderType, setTenderType] = useState<PosTenderType>("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [lastOrderId, setLastOrderId] = useState<number | null>(null);
  const menuItems = useMemo(() => [...foodItems, ...drinkItems], [foodItems, drinkItems]);
  const lines = useMemo(() => menuItems.flatMap((item) => quantities[item.id] > 0 && quantities[item.id] <= item.availableQuantity
    ? [{ menuItemId: item.id, quantity: quantities[item.id], name: item.name, price: item.basePrice }] : []), [menuItems, quantities]);
  const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);

  async function book() {
    setError(null);
    setResult(null);
    if (!lines.some((line) => foodItems.some((item) => item.id === line.menuItemId)) || (saleMode === "preorder" && !arrivalAt)) { setError("Choose at least one traveller item and an arrival time for a preorder."); return; }
    if (orderMode === "combined" && !busReference.trim()) { setError("Enter the bus reference."); return; }
    const payNow = saleMode === "counter" || paymentTiming === "booking";
    const received = payNow ? tenderType === "cash" ? Number(amountReceived) : total : 0;
    if (payNow && (!Number.isInteger(received) || received < total)) {
      setError("Cash received must cover the total."); return;
    }
    if (payNow && tenderType !== "cash" && !/^(?:\d{4}|\d{11})$/.test(paymentReference.trim())) {
      setError("Enter the terminal reference or its last four digits."); return;
    }
    const arrival = saleMode === "preorder" ? new Date(`${arrivalAt}:00+03:00`) : null;
    if (arrival && !Number.isFinite(arrival.getTime())) { setError("Enter a valid Kampala arrival time."); return; }
    const key = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(key);
    setBusy(true);
    try {
      const response = await fetch(saleMode === "counter" ? "/api/admin/pos/travellers/counter" : "/api/admin/pos/travellers/preorders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: key, orderMode, customerName: customerName.trim(),
          customerPhone: customerPhone.trim(), busReference: busReference.trim() || undefined,
          arrivalAt: arrival?.toISOString(), paymentTiming: saleMode === "counter" ? undefined : paymentTiming,
          tenderType: payNow ? tenderType : undefined,
          amountReceived: received,
          paymentReference: payNow ? paymentReference.trim() || undefined : undefined,
          items: lines.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity }))
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "Unable to book preorder.");
      setLastOrderId(Number(payload.data.orderId));
      setResult(saleMode === "counter"
        ? `${payload.data.orderNumber} paid and sent to kitchen. Change: ${money(Number(payload.data.changeGiven))}.`
        : `${payload.data.orderNumber} booked for ${arrivalLabel(payload.data.promisedAt)}. ${payload.data.paymentStatus === "paid" ? "Paid; stock held." : "Payment due on arrival; stock held."}`);
      if (payNow) {
        void sendTravellerReceipt(payload.data.hardware as HardwareResult).then((notice) =>
          setResult((current) => `${current ?? ""} ${notice}`));
      }
      setQuantities({}); setAmountReceived(""); setPaymentReference(""); setIdempotencyKey(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to book preorder.");
    } finally { setBusy(false); }
  }

  return <div className="space-y-5 text-[#111418]">
    <section className="surface-card rounded-[30px] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8B6F5A]">POS travellers</p>
      <h1 className="mt-2 text-2xl font-semibold">Bus traveller orders</h1>
      <p className="mt-2 text-sm text-[#5F6670]">Book one combined order for an organiser or create one order per passenger. Stock is held at booking. Payment can be taken now or on arrival.</p>
    </section>
    {error ? <p className="rounded-xl bg-[#FFF1F1] p-3 text-sm text-[#9F2D2D]">{error}</p> : null}
    {result ? <div className="flex items-center gap-3 rounded-xl bg-[#F2FBF5] p-3 text-sm text-[#166534]"><p>{result}</p>{lastOrderId ? <a href={`/pos/travellers/receipts/${lastOrderId}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border px-2 py-1">Open receipt</a> : null}</div> : null}
    <section className="surface-card rounded-[30px] p-5">
      <h2 className="text-lg font-semibold">New traveller order</h2>
      <label className="mt-4 block text-sm font-semibold">Sale timing
        <select className={fieldClass + " mt-1"} value={saleMode} onChange={(event) => { setSaleMode(event.target.value as "preorder" | "counter"); setIdempotencyKey(null); }}>
          <option value="preorder">Preorder for arrival</option><option value="counter">Counter sale now</option>
        </select>
      </label>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-semibold">Order type
          <select className={fieldClass + " mt-1"} value={orderMode} onChange={(event) => { setOrderMode(event.target.value as OrderMode); setIdempotencyKey(null); }}>
            <option value="combined">One combined bus order</option><option value="individual">One passenger order</option>
          </select>
        </label>
        {saleMode === "preorder" ? <label className="text-sm font-semibold">Arrival time in Kampala
          <input className={fieldClass + " mt-1"} type="datetime-local" value={arrivalAt} onChange={(event) => { setArrivalAt(event.target.value); setIdempotencyKey(null); }} required />
        </label> : null}
        <label className="text-sm font-semibold">{orderMode === "combined" ? "Organiser name" : "Passenger name"}
          <input className={fieldClass + " mt-1"} value={customerName} onChange={(event) => { setCustomerName(event.target.value); setIdempotencyKey(null); }} required />
        </label>
        <label className="text-sm font-semibold">Contact phone
          <input className={fieldClass + " mt-1"} type="tel" value={customerPhone} onChange={(event) => { setCustomerPhone(event.target.value); setIdempotencyKey(null); }} required />
        </label>
        <label className="text-sm font-semibold">Bus reference{orderMode === "individual" ? " (optional)" : ""}
          <input className={fieldClass + " mt-1"} value={busReference} onChange={(event) => { setBusReference(event.target.value); setIdempotencyKey(null); }} required={orderMode === "combined"} />
        </label>
        {saleMode === "preorder" ? <label className="text-sm font-semibold">Payment
          <select className={fieldClass + " mt-1"} value={paymentTiming} onChange={(event) => { setPaymentTiming(event.target.value as PaymentTiming); setIdempotencyKey(null); }}>
            <option value="arrival">Take payment on arrival</option><option value="booking">Take payment now</option>
          </select>
        </label> : null}
      </div>
      <div className="mt-5 space-y-2">
        <h3 className="text-sm font-semibold">Traveller items</h3>
        {foodItems.length === 0 ? <p className="text-sm text-[#8A4A2B]">No traveller foods are active in the POS yet.</p> : null}
        {foodItems.map((item) => <label key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1DC] bg-white p-3 text-sm">
          <span><strong>{item.name}</strong><span className="ml-2 text-[#5F6670]">{money(item.basePrice)} · {item.availableQuantity > 0 ? `${item.availableQuantity} available` : "Out of stock"}</span></span>
          <input className="w-24 rounded-lg border border-[#D7DDE4] px-3 py-2 text-right" type="number" min="0" max={Math.min(200, item.availableQuantity)} step="1" disabled={item.availableQuantity === 0} value={quantities[item.id] ?? 0} onChange={(event) => {
            const value = Math.max(0, Math.min(200, item.availableQuantity, Number(event.target.value) || 0));
            setQuantities((current) => ({ ...current, [item.id]: value })); setIdempotencyKey(null);
          }} />
        </label>)}
      </div>
      <div className="mt-5 space-y-2">
        <h3 className="text-sm font-semibold">Regular drinks</h3>
        <p className="text-xs text-[#5F6670]">These are the standard POS products and use the same stock as other sales.</p>
        {drinkItems.map((item) => <label key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1DC] bg-white p-3 text-sm">
          <span><strong>{item.name}</strong><span className="ml-2 text-[#5F6670]">{money(item.basePrice)} · {item.availableQuantity > 0 ? `${item.availableQuantity} available` : "Out of stock"}</span></span>
          <input className="w-24 rounded-lg border border-[#D7DDE4] px-3 py-2 text-right" type="number" min="0" max={Math.min(200, item.availableQuantity)} step="1" disabled={item.availableQuantity === 0} value={quantities[item.id] ?? 0} onChange={(event) => {
            const value = Math.max(0, Math.min(200, item.availableQuantity, Number(event.target.value) || 0));
            setQuantities((current) => ({ ...current, [item.id]: value })); setIdempotencyKey(null);
          }} />
        </label>)}
      </div>
      {(saleMode === "counter" || paymentTiming === "booking") ? <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Tender
          <select className={fieldClass + " mt-1"} value={tenderType} onChange={(event) => { setTenderType(event.target.value as PosTenderType); setIdempotencyKey(null); }}>
            <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="card">Card</option>
          </select>
        </label>
        {tenderType === "cash" ? <label className="text-sm font-semibold">Cash received
          <input className={fieldClass + " mt-1"} type="number" min={total} step="1" value={amountReceived} onChange={(event) => { setAmountReceived(event.target.value); setIdempotencyKey(null); }} />
        </label> : <label className="text-sm font-semibold">Terminal reference
          <input className={fieldClass + " mt-1"} value={paymentReference} onChange={(event) => { setPaymentReference(event.target.value); setIdempotencyKey(null); }} placeholder="Last 4 or full 11 digits" />
        </label>}
      </div> : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E1DC] pt-4">
        <strong>Total {money(total)}</strong>
        <button type="button" disabled={busy || !lines.some((line) => foodItems.some((item) => item.id === line.menuItemId))} onClick={book} className="rounded-xl bg-[#111418] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving..." : saleMode === "counter" ? "Take payment and send to kitchen" : "Book traveller order"}</button>
      </div>
    </section>
    <section className="surface-card rounded-[30px] p-5">
      <h2 className="text-lg font-semibold">Active traveller preorders</h2>
      <div className="mt-4 space-y-3">
        {preorders.length === 0 ? <p className="text-sm text-[#5F6670]">No active traveller preorders.</p> : preorders.map((preorder) => <ArrivalCard key={preorder.orderId} preorder={preorder} />)}
      </div>
    </section>
  </div>;
}
