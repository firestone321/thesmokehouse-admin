# POS bridge handoff: idempotent paid-online receipts

Apply this on the POS PC's `smokehouse-pos-bridge` checkout, then build and restart the local Node service. Do **not** add or copy an admin private JWK or `BRIDGE_DEV_SECRET`; production remains `AUTH_MODE=jwks` and reads the existing public JWKS URL.

## Required contract

The admin PWA will call:

```http
POST http://127.0.0.1:17891/receipt/print
Authorization: Bearer <short-lived EdDSA JWT>
Idempotency-Key: <print_job_uuid>
Content-Type: application/json
```

The JWT retains `action=print_receipt` and `sale_id`, and now also contains `order_id`, `print_job_id`, and `receipt_hash`. `receipt_hash` is SHA-256/base64url of this exact canonical JSON structure (in this field order):

```ts
{
  saleId: receipt.saleId,
  date: receipt.date,
  items: receipt.items.map(({ name, quantity, unitPrice, total }) => ({ name, quantity, unitPrice, total })),
  subtotal: receipt.subtotal,
  total: receipt.total,
  paymentMethod: receipt.paymentMethod
}
```

## Source changes

1. In `src/server.ts`, allow `Idempotency-Key` in CORS `allowedHeaders`. Require it to be a UUID only when the JWT contains a `print_job_id`; retain the existing POS-sale path when the claim/header is absent.

2. Add `src/receipt-fingerprint.ts` with the canonical structure above and:

```ts
import { createHash } from "node:crypto";
import type { Receipt } from "./types.js";

export function receiptFingerprint(receipt: Receipt): string {
  const value = {
    saleId: receipt.saleId,
    date: receipt.date,
    items: receipt.items.map(({ name, quantity, unitPrice, total }) => ({ name, quantity, unitPrice, total })),
    subtotal: receipt.subtotal,
    total: receipt.total,
    paymentMethod: receipt.paymentMethod
  };
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("base64url");
}
```

3. Extend `HardwareAuthorizer.authorize` for receipt-print requests to return the verified claims. When the request uses an idempotency key, require all of these exact matches before printing:

```ts
payload.action === "print_receipt"
payload.sale_id === receipt.saleId
payload.print_job_id === request.header("idempotency-key")
payload.receipt_hash === receiptFingerprint(receipt)
typeof payload.order_id === "string" && /^\d+$/.test(payload.order_id)
```

Existing drawer and POS-sale receipt authorization remains unchanged.

4. Add a durable receipt-job ledger under the bridge installation directory, for example `data/receipt-print-jobs.json`. It must be written atomically (write a sibling temporary file, then rename) before handing a new idempotency key to the Windows spooler. Record at least `jobId`, `saleId`, receipt fingerprint, accepted timestamp, and spool outcome.

5. In `/receipt/print`, after authorization:

   - if `Idempotency-Key` already exists with the same sale ID and fingerprint, return its original `202` result without calling `printer.printReceipt()`;
   - if the key exists with different receipt data, return `409`;
   - for a new key, persist the accepted ledger entry **before** calling the printer, then submit exactly once;
   - return `{ ok: true, jobId, saleId, status: "queued" }` for both the first and duplicate request.

This deliberately gives at-most-once submission. If Windows crashes after the durable acceptance but before the spooler accepts it, do not silently retry the same job; use an explicit new reprint job after investigation.

## Target-device commands

From the bridge project root on the POS PC:

```powershell
npm run build
npm test
```

Then restart the installed bridge service/task using its existing production installer workflow. Confirm `GET http://127.0.0.1:17891/health` is healthy and that the configured `ALLOWED_ORIGIN` is `https://admin.firestonesmokehouse.com`.

Before the first real paid order, run a controlled browser request twice with the same signed job and `Idempotency-Key`; it must return the same `jobId` twice and submit only one Windows spooler job. Repeat after restarting the bridge to prove the ledger survives a process restart.
