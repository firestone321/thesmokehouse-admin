"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Batch = { id: number; sourceName: string; quantityProduced: number; alreadyConverted: number; pooledStock: number; processedAt: string };
function kampalaDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function TravellerBeefConversionForm({ batches }: { batches: Batch[] }) {
  const router = useRouter();
  const [batchId, setBatchId] = useState(batches[0]?.id ?? 0);
  const [sourceCount, setSourceCount] = useState("");
  const [skewers, setSkewers] = useState("");
  const [samosas, setSamosas] = useState("");
  const [cookedOn, setCookedOn] = useState(batches[0] ? kampalaDate(new Date(batches[0].processedAt)) : "");
  const [reference, setReference] = useState("");
  const [acknowledgeEarly, setAcknowledgeEarly] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = useMemo(() => batches.find((batch) => batch.id === batchId), [batches, batchId]);
  const today = kampalaDate(new Date());
  const ageDays = cookedOn ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${cookedOn}T00:00:00Z`)) / 86400000) : 0;
  const young = ageDays < 2;
  const availableFromBatch = selected ? Math.min(selected.quantityProduced - selected.alreadyConverted, selected.pooledStock) : 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const sourcePortionsUsed = Number(sourceCount);
    const skewersProduced = Number(skewers || 0);
    const samosasProduced = Number(samosas || 0);
    if (!selected || !Number.isInteger(sourcePortionsUsed) || sourcePortionsUsed < 1 || sourcePortionsUsed > availableFromBatch
      || !Number.isInteger(skewersProduced) || !Number.isInteger(samosasProduced)
      || skewersProduced < 0 || samosasProduced < 0 || skewersProduced + samosasProduced < 1) {
      setError("Enter valid source and actual output counts."); return;
    }
    if (young && !acknowledgeEarly) { setError("Acknowledge the under-two-day exception."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/procurement/travellers/beef-conversions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceProcessingBatchId: batchId, sourcePortionsUsed,
          skewersProduced, samosasProduced, cookedOn, earlyConversionAcknowledged: acknowledgeEarly,
          batchReference: reference.trim(), note: note.trim() })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "Conversion failed.");
      setMessage(`Beef conversion #${payload.conversionId} recorded.`);
      setSourceCount(""); setSkewers(""); setSamosas(""); setReference(""); setNote(""); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Conversion failed."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-5 text-[#111418]">
    <section className="surface-card rounded-[30px] p-5">
      <h1 className="text-2xl font-semibold">Convert cooked beef for travellers</h1>
      <p className="mt-2 text-sm text-[#5F6670]">Choose the physical unsold cooked batch and count the original beef portions and finished skewers or samosas. This removes original finished stock and adds the new pieces in one transaction.</p>
      <p className="mt-2 text-sm text-[#8A4A2B]">Sales currently use pooled stock, so the batch selection is a staff attestation. Check the physical batch before recording. The system checks pooled stock and prevents converting more than the batch originally produced.</p>
    </section>
    <form onSubmit={submit} className="surface-card grid gap-4 rounded-[30px] p-5 sm:grid-cols-2">
      <label className="text-sm font-semibold sm:col-span-2">Cooked source batch
        <select className="mt-1 w-full rounded-xl border p-3" value={batchId} onChange={(e) => {
          const id = Number(e.target.value); const batch = batches.find((item) => item.id === id);
          setBatchId(id); setCookedOn(batch ? kampalaDate(new Date(batch.processedAt)) : ""); setAcknowledgeEarly(false);
        }} required>{batches.map((batch) => <option key={batch.id} value={batch.id}>#{batch.id} {batch.sourceName} · {batch.quantityProduced - batch.alreadyConverted} unconverted in batch · {batch.pooledStock} pooled stock · processed {kampalaDate(new Date(batch.processedAt))}</option>)}</select>
      </label>
      <label className="text-sm font-semibold">Original portions physically used
        <input className="mt-1 w-full rounded-xl border p-3" type="number" min="1" max={availableFromBatch} step="1" value={sourceCount} onChange={(e) => setSourceCount(e.target.value)} required />
      </label>
      <label className="text-sm font-semibold">Cooking date
        <input className="mt-1 w-full rounded-xl border p-3" type="date" max={today} value={cookedOn} onChange={(e) => { setCookedOn(e.target.value); setAcknowledgeEarly(false); }} required />
      </label>
      <label className="text-sm font-semibold">Finished beef skewers
        <input className="mt-1 w-full rounded-xl border p-3" type="number" min="0" max="10000" step="1" value={skewers} onChange={(e) => setSkewers(e.target.value)} />
      </label>
      <label className="text-sm font-semibold">Finished beef samosas
        <input className="mt-1 w-full rounded-xl border p-3" type="number" min="0" max="10000" step="1" value={samosas} onChange={(e) => setSamosas(e.target.value)} />
      </label>
      <label className="text-sm font-semibold">Conversion batch reference
        <input className="mt-1 w-full rounded-xl border p-3" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} required />
      </label>
      <label className="text-sm font-semibold">Note (optional)
        <input className="mt-1 w-full rounded-xl border p-3" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {young ? <label className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm sm:col-span-2"><input type="checkbox" checked={acknowledgeEarly} onChange={(e) => setAcknowledgeEarly(e.target.checked)} />This batch is under two days old. I confirm an early conversion.</label> : <p className="text-sm text-green-700 sm:col-span-2">Cooking date is at least two days ago.</p>}
      {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
      {message ? <p className="text-sm text-green-700 sm:col-span-2">{message}</p> : null}
      <button className="rounded-xl bg-[#111418] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2" disabled={busy || !selected || availableFromBatch < 1}>{busy ? "Recording..." : "Convert counted beef stock"}</button>
    </form>
  </div>;
}