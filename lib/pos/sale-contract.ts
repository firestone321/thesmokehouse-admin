export type SalePayload = {
  idempotencyKey: string;
  tenderType: "cash" | "mobile_money" | "card";
  amountReceived: number;
  paymentReference?: string;
  items: Array<{ menuItemId: number; quantity: number }>;
};
export type SaleReceipt = {
  orderId: number; orderNumber: string; status: string; totalAmount: number;
  tenderType: string; amountReceived: number; changeGiven: number;
  canonicalReceipt: {
    saleId: string; date: string;
    items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
    subtotal: number; total: number; paymentMethod: "cash" | "mobile_money" | "card";
  };
  hardwareEnabled: boolean;
};
export type SaleState = "prepared" | "submitting" | "committed" | "rejected" | "outcome_unknown" | "needs_review";
export type HardwareState = "not_requested" | "pending" | "submitted" | "failed" | "outcome_unknown";
export type HardwareOperation = { state: HardwareState; requestId: string; message?: string };
export type SaleAttempt = {
  ownerId: string; payload: SalePayload; state: SaleState; updatedAt: number;
  receipt?: SaleReceipt; message?: string;
  hardware: { drawer: HardwareOperation; receipt: HardwareOperation };
};
export function newAttempt(ownerId: string, payload: SalePayload): SaleAttempt {
  return { ownerId, payload: structuredClone(payload), state: "prepared", updatedAt: Date.now(),
    hardware: { drawer: { state: "not_requested", requestId: "original" }, receipt: { state: "not_requested", requestId: "original" } } };
}
export function restoreAttempt(attempt: SaleAttempt): SaleAttempt {
  const restored = structuredClone(attempt);
  if (restored.state === "submitting") restored.state = "outcome_unknown";
  for (const kind of ["drawer", "receipt"] as const) {
    if (restored.hardware[kind].state === "pending") restored.hardware[kind].state = "outcome_unknown";
  }
  return restored;
}
export function isUnresolved(state: SaleState): boolean {
  return state === "prepared" || state === "submitting" || state === "outcome_unknown" || state === "needs_review";
}
export function hashableSale(input: SalePayload): string {
  return JSON.stringify({ tenderType: input.tenderType, amountReceived: input.amountReceived,
    paymentReference: input.paymentReference?.trim() || null,
    items: [...input.items].sort((a, b) => a.menuItemId - b.menuItemId) });
}
