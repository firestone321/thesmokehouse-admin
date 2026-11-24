import type { SaleAttempt } from "./sale-contract";
const DATABASE = "smokehouse-walk-in-sales-v1";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const attempts = request.result.createObjectStore("attempts", { keyPath: "payload.idempotencyKey" });
      attempts.createIndex("ownerId", "ownerId");
      request.result.createObjectStore("active", { keyPath: "ownerId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Local sale storage is unavailable. No new sale was submitted."));
    request.onblocked = () => reject(new Error("Close older POS tabs to unlock local sale storage."));
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(["attempts", "active"], mode);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(new Error("Unable to preserve the sale locally. Stop and review before retrying."));
      try { run(tx, (value) => { result = value; }); } catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}
export async function readActiveAttempt(ownerId: string): Promise<SaleAttempt | null> {
  const value = await transaction<SaleAttempt | null | { invalid: true; key?: string }>("readonly", (tx, result) => {
    const pointer = tx.objectStore("active").get(ownerId);
    pointer.onsuccess = () => {
      if (!pointer.result) return result(null);
      const key = pointer.result.key;
      if (typeof key !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(key)) return result({ invalid: true });
      const request = tx.objectStore("attempts").get(key);
      request.onsuccess = () => {
        const a = request.result as SaleAttempt | undefined;
        const valid = a && a.ownerId === ownerId && a.payload?.idempotencyKey === key &&
          ["prepared", "submitting", "committed", "rejected", "outcome_unknown", "needs_review"].includes(a.state) &&
          ["cash", "card", "mobile_money"].includes(a.payload.tenderType) && Number.isFinite(a.payload.amountReceived) &&
          Array.isArray(a.payload.items) && a.payload.items.length > 0 &&
          a.payload.items.every((item) => item && Number.isInteger(item.menuItemId) && Number.isInteger(item.quantity) && item.quantity > 0) &&
          Number.isFinite(a.updatedAt) && a.hardware?.drawer && a.hardware?.receipt &&
          [a.hardware.drawer, a.hardware.receipt].every((action) =>
            ["not_requested", "pending", "submitted", "failed", "outcome_unknown"].includes(action.state) && typeof action.requestId === "string" && action.requestId.length > 0) &&
          (a.state !== "committed" || !!a.receipt?.orderNumber);
        result(valid ? a : { invalid: true, key });
      };
    };
  });
  if (value && "invalid" in value) throw new Error(`Preserved sale data is incomplete${value.key ? ` (reference ${value.key})` : ""}. Ask a manager to review this POS. Do not clear storage or record the payment again.`);
  return value;
}
export async function readAttempt(ownerId: string, key: string): Promise<SaleAttempt | null> {
  return transaction("readonly", (tx, result) => {
    const request = tx.objectStore("attempts").get(key);
    request.onsuccess = () => result(request.result?.ownerId === ownerId ? request.result : null);
  });
}
export async function saveAttempt(attempt: SaleAttempt, activate = true): Promise<void> {
  await transaction<void>("readwrite", (tx, result) => {
    tx.objectStore("attempts").put(attempt);
    if (activate) tx.objectStore("active").put({ ownerId: attempt.ownerId, key: attempt.payload.idempotencyKey });
    result(undefined);
  });
  // Other tabs reload state; no sale payload or payment reference crosses this channel.
  const channel = new BroadcastChannel(DATABASE); channel.postMessage("changed"); channel.close();
}
export async function closeAttempt(ownerId: string): Promise<void> {
  await transaction<void>("readwrite", (tx, result) => { tx.objectStore("active").delete(ownerId); result(undefined); });
  const channel = new BroadcastChannel(DATABASE); channel.postMessage("changed"); channel.close();
}
export async function listRecordedAttempts(ownerId: string): Promise<SaleAttempt[]> {
  return transaction("readonly", (tx, result) => {
    const request = tx.objectStore("attempts").index("ownerId").getAll(ownerId);
    request.onsuccess = () => result((request.result as SaleAttempt[]).filter((a) => a.state === "committed").sort((a,b) => b.updatedAt-a.updatedAt).slice(0,10));
  });
}
export async function withSaleLock<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error("This browser cannot coordinate POS tabs safely. Use a current Chromium browser.");
  return navigator.locks.request("smokehouse-walk-in-sale:" + ownerId, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Another POS tab is handling this cashier's sale. Wait for it or close that tab, then check the original outcome.");
    return work();
  });
}
export function watchAttempts(refresh: () => void): () => void {
  const channel = new BroadcastChannel(DATABASE); channel.onmessage = refresh;
  return () => channel.close();
}
