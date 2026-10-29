"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { closeAttempt, listRecordedAttempts, readActiveAttempt, saveAttempt, watchAttempts, withSaleLock } from "./attempt-store";
import { isUnresolved, newAttempt, restoreAttempt, type SaleAttempt, type SalePayload } from "./sale-contract";
import { dispatchCashHardware } from "./hardware-dispatch";
import { lookupHardware, submitHardware, type HardwareKind, type Instructions } from "./hardware-client";
import { posTimer } from "./timing";

export function usePosSale(ownerId: string) {
  const [attempt, setAttempt] = useState<SaleAttempt | null>(null);
  const [history, setHistory] = useState<SaleAttempt[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const running = useRef(false);
  const refresh = useCallback(async () => {
    setAttempt(await readActiveAttempt(ownerId));
    setHistory(await listRecordedAttempts(ownerId));
  }, [ownerId]);
  useEffect(() => {
    let disposed = false;
    const update = () => { void refresh().catch(() => { if (!disposed) setMessage("Unable to read local sale storage. Stop and review."); }); };
    const unsubscribe = watchAttempts(update);
    void (async () => {
      try {
        await withSaleLock(ownerId, async () => {
          const prior = await readActiveAttempt(ownerId);
          if (prior) await saveAttempt(restoreAttempt(prior));
        });
      } catch (error) {
        if (!disposed) setMessage(error instanceof Error ? error.message : "Unable to restore pending sale.");
      }
      try { if (!disposed) { await refresh(); setReady(true); } }
      catch { if (!disposed) setMessage("Local sale storage is unavailable. Sale submission is disabled."); }
    })();
    window.addEventListener("focus", update);
    return () => { disposed = true; unsubscribe(); window.removeEventListener("focus", update); };
  }, [ownerId, refresh]);

  async function persist(value: SaleAttempt) {
    const next = { ...value, updatedAt: Date.now() };
    await saveAttempt(next); setAttempt(next); return next;
  }
  async function run(work: () => Promise<void>) {
    if (running.current || !ready) return;
    running.current = true; setBusy(true); setMessage(null);
    try { await withSaleLock(ownerId, work); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operation could not be preserved. Review the original sale."); }
    finally { running.current = false; setBusy(false); await refresh().catch(() => setMessage("Unable to reload local state. Do not start a replacement sale.")); }
  }
  async function perform(value: SaleAttempt, kind: HardwareKind, initial?: Instructions | null): Promise<SaleAttempt> {
    let current = await persist({ ...value, hardware: { ...value.hardware, [kind]: { ...value.hardware[kind], state: "pending" } } });
    const result = await submitHardware(current, kind, initial);
    current = await persist({ ...current, hardware: { ...current.hardware, [kind]: result } });
    return current;
  }
  async function post(value: SaleAttempt, initial: boolean) {
    let current = await persist({ ...value, state: "submitting", message: undefined });
    const tick = posTimer(current.payload.idempotencyKey);
    let result;
    try {
      tick("api_request_dispatched");
      const response = await fetch("/api/admin/pos/sales", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current.payload), signal: AbortSignal.timeout(30_000) });
      result = await response.json();
      tick("api_response_received", result.ok ? "ok" : "unknown");
      if (!response.ok || !result.ok) {
        await persist({ ...current, state: initial && result.outcome === "rejected" ? "rejected" : "outcome_unknown",
          message: result.message || "Sale outcome unknown. Check the original outcome." }); return;
      }
      if (!result.data?.orderId || !result.data?.canonicalReceipt?.items?.length) throw new Error("Invalid confirmation");
    } catch {
      await persist({ ...current, state: "outcome_unknown", message: "Sale outcome unknown. Confirmation was lost. Keep this request identity." }); return;
    }
    current = await persist({ ...current, state: "committed", receipt: result.data, message: "Sale recorded successfully." });
    // Restoring/retrying a sale NEVER automatically replays hardware.
    if (initial && current.receipt?.tenderType === "cash" && current.receipt.hardwareEnabled) {
      await dispatchCashHardware(
        async () => { current = await perform(current, "drawer", result.hardware?.drawer); },
        async () => {
          // Reload durable state if an earlier local write failed; do not reset any action.
          current = (await readActiveAttempt(ownerId)) || current;
          current = await perform(current, "receipt", result.hardware?.receipt);
        });
    }
  }
  async function submit(input: Omit<SalePayload, "idempotencyKey">) {
    await run(async () => {
      if (await readActiveAttempt(ownerId)) throw new Error("Resolve or close the existing sale first. No replacement was submitted.");
      const value = newAttempt(ownerId, { ...input, idempotencyKey: crypto.randomUUID() });
      const tick = posTimer(value.payload.idempotencyKey); tick("sale_submission_initiated");
      await persist(value); await post(value, true);
    });
  }
  async function checkOutcome() {
    await run(async () => {
      const prior = await readActiveAttempt(ownerId); if (!prior) return;
      const current = restoreAttempt(prior);
      try {
        const response = await fetch("/api/admin/pos/sales/" + current.payload.idempotencyKey, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || "Unable to resolve sale.");
        if (result.outcome === "committed") {
          await persist({ ...current, state: "committed", receipt: result.data,
            message: "Original sale restored. Hardware was not replayed; review its status separately." });
        } else {
          await persist({ ...current, state: "prepared", message: "No committed sale found for this cashier and key. Retry only this preserved request; another request may still be in flight." });
        }
      } catch {
        await persist({ ...current, state: current.state === "committed" ? "committed" : "needs_review",
          message: "Unable to resolve the original outcome. Sign in as its cashier and check again. No replacement was created." });
      }
    });
  }
  async function retryOriginal() {
    await run(async () => {
      const current = await readActiveAttempt(ownerId);
      if (!current || current.state !== "prepared") throw new Error("Check the original outcome before retrying.");
      await post(current, false);
    });
  }
  async function startNew() {
    await run(async () => {
      const current = await readActiveAttempt(ownerId);
      if (current && isUnresolved(current.state)) throw new Error("The original sale must be resolved before starting another.");
      await closeAttempt(ownerId); setAttempt(null);
    });
  }
  async function reprint() {
    await run(async () => {
      let current = await readActiveAttempt(ownerId);
      if (current?.state !== "committed" || current.receipt?.tenderType !== "cash" || !current.receipt.hardwareEnabled) throw new Error("A committed local-printer cash sale is required.");
      if (current.hardware.receipt.state === "outcome_unknown" &&
        !window.confirm("The earlier receipt may already have printed. Submit a separate reprint? The drawer will not open.")) return;
      current = await persist({ ...current, hardware: { ...current.hardware, receipt: { state: "not_requested", requestId: crypto.randomUUID() } } });
      await perform(current, "receipt");
    });
  }
  async function checkHardware() {
    await run(async () => {
      let current = await readActiveAttempt(ownerId); if (current?.state !== "committed") return;
      for (const kind of ["drawer", "receipt"] as const) {
        if (!["pending", "outcome_unknown"].includes(current.hardware[kind].state)) continue;
        try {
          const operation = await lookupHardware(current, kind);
          current = await persist({ ...current, hardware: { ...current.hardware, [kind]: operation } });
        } catch { setMessage("Hardware status unavailable. Verify the original POS PC and bridge. No action was repeated."); }
      }
    });
  }
  async function reviewRecorded(value: SaleAttempt) {
    await run(async () => {
      if (await readActiveAttempt(ownerId)) throw new Error("Close the current sale before opening history.");
      if (value.ownerId !== ownerId || value.state !== "committed") throw new Error("Sale review is not permitted.");
      await persist(restoreAttempt(value));
    });
  }
  return { attempt, history, ready, busy, message, submit, checkOutcome, retryOriginal, startNew, reprint, checkHardware, reviewRecorded };
}
