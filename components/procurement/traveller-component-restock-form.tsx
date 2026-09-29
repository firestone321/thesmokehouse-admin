"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { code: string; name: string; label: string; stock: number };
type History = { id: number; sourceReference: string; quantity: number; recordedAt: string; name: string };

export function TravellerComponentRestockForm({ options, history }: { options: Option[]; history: History[] }) {
  const router = useRouter();
  const [portionCode, setPortionCode] = useState(options[0]?.code ?? "");
  const [sourceReference, setSourceReference] = useState("");
  const [quantity, setQuantity] = useState("");
  const [sourceUnits, setSourceUnits] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const quantityCounted = Number(quantity);
    if (!Number.isInteger(quantityCounted) || quantityCounted < 1 || quantityCounted > 10000) {
      setError("Enter the actual count of finished servings (1–10,000)."); return;
    }
    if (portionCode === "soda_bottle_330ml" && (!Number.isInteger(Number(sourceUnits)) || Number(sourceUnits) < 1)) {
      setError("Enter the number of raw soda cartons used."); return;
    }
    if (portionCode === "traveller_sauce" && (!Number.isInteger(Number(sourceUnits)) || Number(sourceUnits) < 0 || Number(sourceUnits) > quantityCounted)) {
      setError("Enter how many tracked sauce cups were actually used (0 up to the serving count)."); return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/procurement/travellers/components", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portionCode, sourceReference: sourceReference.trim(), quantityCounted, sourceUnitsConsumed: portionCode === "traveller_salad" ? undefined : Number(sourceUnits), note: note.trim() })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "Restock could not be saved.");
      setMessage(`Counted restock #${payload.restockId} recorded.`);
      setQuantity(""); setSourceUnits(""); setSourceReference(""); setNote(""); router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Restock could not be saved.");
    } finally { setBusy(false); }
  }

  return <div className="space-y-5 text-[#111418]">
    <section className="surface-card rounded-[30px] p-5">
      <h1 className="text-2xl font-semibold">Traveller serving restock</h1>
      <p className="mt-2 text-sm text-[#5F6670]">Count finished salad servings and filled sauce cups, or shared 330 ml soda bottles/cans. Each count credits that physical stock once. Existing raw supply balances are not converted here.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">{options.map((option) => <div key={option.code} className="rounded-xl border border-[#E5E1DC] bg-white p-3"><div className="font-semibold">{option.name}</div><div className="text-sm text-[#5F6670]">{option.stock} {option.label} in stock</div></div>)}</div>
    </section>
    <form onSubmit={submit} className="surface-card grid gap-4 rounded-[30px] p-5 sm:grid-cols-2">
      <label className="text-sm font-semibold">Finished serving
        <select className="mt-1 w-full rounded-xl border p-3" value={portionCode} onChange={(e) => setPortionCode(e.target.value)} required>{options.map((option) => <option key={option.code} value={option.code}>{option.name} ({option.label})</option>)}</select>
      </label>
      <label className="text-sm font-semibold">Actual finished count
        <input className="mt-1 w-full rounded-xl border p-3" type="number" min="1" max="10000" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
      </label>
      {portionCode === "traveller_sauce" ? <label className="text-sm font-semibold">Tracked sauce cups actually used
        <input className="mt-1 w-full rounded-xl border p-3" type="number" min="0" max={quantity || undefined} step="1" value={sourceUnits} onChange={(e) => setSourceUnits(e.target.value)} required />
        <span className="mt-1 block text-xs font-normal text-[#5F6670]">Enter 0 if this preparation batch used no cups from the tracked raw balance.</span>
      </label> : null}
      {portionCode === "soda_bottle_330ml" ? <label className="text-sm font-semibold">Raw soda cartons used
        <input className="mt-1 w-full rounded-xl border p-3" type="number" min="1" step="1" value={sourceUnits} onChange={(e) => setSourceUnits(e.target.value)} required />
      </label> : null}
      <label className="text-sm font-semibold">Batch or delivery reference
        <input className="mt-1 w-full rounded-xl border p-3" maxLength={120} value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} required placeholder="Use the receipt or preparation batch ID" />
      </label>
      <label className="text-sm font-semibold">Note (optional)
        <input className="mt-1 w-full rounded-xl border p-3" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
      {message ? <p className="text-sm text-green-700 sm:col-span-2">{message}</p> : null}
      <button className="rounded-xl bg-[#111418] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2" disabled={busy || !portionCode}>{busy ? "Recording..." : "Record counted servings"}</button>
    </form>
    <section className="surface-card rounded-[30px] p-5"><h2 className="text-lg font-semibold">Recent counted restocks</h2><ul className="mt-3 space-y-2 text-sm">{history.map((row) => <li key={row.id} className="rounded-xl border bg-white p-3">{row.quantity} × {row.name} · {row.sourceReference} · {new Date(row.recordedAt).toLocaleString("en-UG", { timeZone: "Africa/Kampala" })}</li>)}</ul></section>
  </div>;
}