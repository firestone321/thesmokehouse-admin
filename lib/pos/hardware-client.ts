import type { HardwareOperation, SaleAttempt } from "./sale-contract";
import { posTimer } from "./timing";
export type HardwareKind = "drawer" | "receipt";
export type Instructions = { bridgeUrl: string; authorization: string; actionId: string; saleId: string; receipt: unknown; expiresAt?: number };
async function instructions(attempt: SaleAttempt, kind: HardwareKind): Promise<Instructions> {
  const response = await fetch("/api/admin/pos/sales/" + attempt.payload.idempotencyKey + "/hardware", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, requestId: attempt.hardware[kind].requestId }),
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.message || "Unable to authorize hardware. Sale remains recorded.");
  return payload.data;
}
export async function submitHardware(attempt: SaleAttempt, kind: HardwareKind, initial?: Instructions | null): Promise<HardwareOperation> {
  const operation = attempt.hardware[kind];
  const tick = posTimer(attempt.payload.idempotencyKey);
  let job: Instructions;
  try { job = initial && initial.expiresAt && initial.expiresAt > Date.now() + 5_000 ? initial : await instructions(attempt, kind); }
  catch { return { ...operation, state: "failed", message: "Hardware authorization unavailable. Sale remains recorded." }; }
  try {
    tick(kind === "drawer" ? "drawer_request_dispatched" : "receipt_request_dispatched");
    const response = await fetch(job.bridgeUrl + "/pos/" + (kind === "drawer" ? "drawer/open" : "receipt/print"), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + job.authorization },
      body: JSON.stringify({ saleId: job.saleId, actionId: job.actionId, ...(kind === "receipt" ? { receipt: job.receipt } : {}) }),
      signal: AbortSignal.timeout(45_000)
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.status === "submitted") {
      tick(kind === "drawer" ? "drawer_bridge_acknowledged" : "receipt_bridge_acknowledged");
      return { ...operation, state: "submitted", message: kind === "drawer" ? "Drawer command submitted to Windows." : "Receipt submitted to Windows." };
    }
    if (!payload || payload?.error?.code === "hardware_outcome_unknown" || response.status >= 500) {
      return { ...operation, state: "outcome_unknown", message: "Hardware outcome uncertain. Check status; do not repeat the drawer command." };
    }
    return { ...operation, state: "failed", message: payload?.error?.message || "Bridge rejected the command. Check the bridge version and permissions." };
  } catch {
    return { ...operation, state: "outcome_unknown", message: "Hardware outcome uncertain. Confirmation was lost; no automatic replay." };
  }
}
export async function lookupHardware(attempt: SaleAttempt, kind: HardwareKind): Promise<HardwareOperation> {
  const operation = attempt.hardware[kind];
  const job = await instructions(attempt, kind);
  const response = await fetch(job.bridgeUrl + "/pos/actions/status", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + job.authorization },
    body: JSON.stringify({ saleId: job.saleId, actionId: job.actionId, kind }),
    signal: AbortSignal.timeout(8_000)
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error("Unable to inspect local hardware status. No command was repeated.");
  if (payload.status === "submitted") return { ...operation, state: "submitted", message: "Windows submission recorded; physical output is unverified." };
  if (payload.status === "rejected") return { ...operation, state: "failed", message: "Bridge recorded a rejection before Windows submission. No command was repeated." };
  return { ...operation, state: "outcome_unknown", message: payload.status === "not_requested"
    ? "No action record on this bridge. Verify this is the original POS PC; staff review required."
    : "Prior hardware outcome remains uncertain. Staff review required; no automatic replay." };
}
