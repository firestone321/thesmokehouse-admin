# Smokehouse Traffic Resilience Audit

Date: 2026-05-06

Scope:

- Peak traffic survival
- Correctness under stress
- Admin repo: `C:\Users\jurug\OneDrive\VS Code\Web Development\thesmokehouse-admin`
- Storefront repo: `C:\Users\jurug\OneDrive\VS Code\Web Development\thesmokehouse`
- Reference repos: `kira_bakery`, `kira-bakery-admin`

Non-goals:

- Generic feature audit
- UI polish review
- Deployment blessing

Important verification rule:

- This audit verifies local code and local SQL only.
- Do not count a migration as safe until Supabase rollout is verified.
- Do not count env-dependent behavior as safe until production env vars are verified.

## Executive Verdict

Smokehouse is not peak-ready and not rush-production-ready.

It has serious correctness foundations: DB-backed rate limiting, paid-only stock deduction, row locks in stock/payment RPCs, duplicate callback tolerance, and fulfillment review on paid-stock failure.

But under KFC-style burst traffic it can still accept money for stock that is gone, strand paid/pending orders without a durable scheduler, overload public menu reads, and create admin reconciliation fanout across open devices.

## Severity Table

| Severity | Count | Main Theme |
|---|---:|---|
| Critical | 1 | Paid/pending recovery can strand truth without durable drain |
| X-High | 2 | Money can outrun stock; Pesapal callbacks can be rate-limited under provider bursts |
| High | 5 | Uncached menu, non-idempotent checkout, admin realtime fanout, queue backlog limits, admin push fanout |
| Medium | 6 | Public order detail abuse, body-size gaps, route-level admin limits, reconciliation gaps, env/migration proof |
| Low | 2 | Observability and semantics cleanup |

## Findings

| ID | Severity | Status | Repo / Evidence | Failure Scenario | Production Impact | Minimal Fix | Priority |
|---|---|---|---|---|---|---|---|
| SH-P0-01 | X-High | mitigated locally; live verification needed | Storefront order validates stock before payment but does not reserve: `thesmokehouse/app/api/orders/route.ts:100`, `thesmokehouse/app/api/orders/route.ts:185`. Paid stock deducts later in DB: `thesmokehouse-admin/db/merged-live-schema.sql:3444`. Local mitigation adds admin sellable-stock warning tiers and storefront low-stock counts: `thesmokehouse-admin/lib/ops/utils.ts`, `thesmokehouse/components/menu-client.tsx` | 20 users pay for the same low-stock item | Money can still be accepted after stock is gone, but paid truth stays sticky and stock-loss should surface as review instead of disappearing | Accepted no-hold model: keep paid-sticky review flow, raise admin priority at <=30, elevated at <=20, critical at <=15, and show storefront remaining count at <=20 | P0 |
| SH-P0-02 | Critical | fixed locally; live migration/env needs verification | Pending recovery was opportunistic, in-memory, 2-at-a-time, 2-hour lookback. Local fix adds `pending_payment_recoveries`, `enqueue_pending_payment_recovery(...)`, `claim_pending_payment_recoveries(...)`, DB-backed storefront recovery, a signed internal recovery endpoint, and admin `Recover payments`: `thesmokehouse-admin/db/phase-37-durable-pending-payment-recovery.sql`, `thesmokehouse/lib/payments/order-payments.ts` | Callback delayed/lost; low traffic after rush | Before live rollout, paid order can remain pending/invisible or missed after lookback | Roll out Phase 37 to Supabase, verify RPC grants/env, and live-test callback-loss/manual recovery | P0 |
| SH-P0-03 | X-High | fixed locally; live env/deploy verification needed | Callback/IPN now bucket valid provider events by token/tracking and IPN ACKs before async verification: `thesmokehouse/app/api/payments/pesapal/callback/route.ts`, `thesmokehouse/app/api/payments/pesapal/ipn/route.ts` | Pesapal duplicate/delayed bursts hit 429 | Before deploy, valid payment truth may not sync; after local fix, unrelated provider events should not share one tight bucket | Deploy storefront change, verify provider callback/IPN payload identifiers in live logs, and confirm async IPN verification fires after ACK | P0 |
| SH-P1-04 | High | fixed locally; live rollout needed | `/api/menu` is force-dynamic, uncached, unrated, and DB-backed: `thesmokehouse/app/api/menu/route.ts:7`, `thesmokehouse/app/api/menu/route.ts:18` | 200 browsers repeatedly load menu during lunch | DB becomes the bottleneck | Short TTL cache/SWR, single RPC/read model, rate limit abuse path | P0 |
| SH-P1-05 | High | fixed locally; Phase 42 rollout needed | Checkout now uses client UUID idempotency plus durable reservation/order binding: `thesmokehouse/app/api/orders/route.ts`, `thesmokehouse-admin/db/phase-42-durable-checkout-idempotency-binding.sql` | Double tap/retry or Vercel crash after order creation | Before Phase 42 rollout, duplicate pending orders remain possible after a crash; after rollout, retries should resume the original order | Apply Phase 42, verify stale processing rows with `order_id` resume instead of creating a second order | P1 |
| SH-P1-06 | High | mitigated locally; deploy verification needed | Realtime manager batches/hidden-pauses events and panels now batch ID reconciliation through `/api/admin/orders/reconcile`: `thesmokehouse-admin/lib/ops/orders-realtime.ts`, `components/orders/live-orders-panel.tsx`, `components/dashboard/live-dashboard.tsx`, `app/api/admin/orders/reconcile/route.ts` | Many admin devices plus many order item updates | Reduces per-event fetch storms; still depends on live admin-device behavior under rush | Deploy and verify one reconcile call per burst per tab, with capped snapshot fallback above 50 IDs | P1 |
| SH-P1-07 | High | migration reported applied; verify live RPC responses | Orders page queue health uses two snapshot RPCs: `thesmokehouse-admin/db/phase-41-push-queue-snapshot-rpc.sql`, `thesmokehouse-admin/lib/ops/queries.ts:810` | Staff refreshes under rush | Queue-count load should no longer stack as many count/preview queries | Verify `get_admin_push_queue_snapshot(...)` and `get_storefront_push_queue_snapshot(...)` in live Supabase logs | P1 |
| SH-P1-08 | High | mitigated locally; deploy verification needed | Admin paid-order push now caps active subscriptions and uses bounded dispatch/send concurrency: `thesmokehouse-admin/lib/push/admin-paid-order-notifications.ts` | Many admin devices slow dispatch | Reduces unbounded fanout/backlog risk, but still depends on production device count and push vendor latency | Deploy and verify queue ticks stay bounded: max 10 staff subscriptions per dispatch, send concurrency 5, dispatch concurrency 3 | P1 |
| SH-P2-09 | Medium | mitigated locally; deploy verification needed | Customer Ready queue now drains 10 per opportunistic scan with dispatch concurrency 3 and send concurrency 5: `thesmokehouse/lib/push/order-ready.ts` | Ready push backlog after rush or quiet periods | Reduces backlog risk, but customer push delivery still depends on subscription health/vendor acceptance | Deploy and verify `order_ready_push_due_scan_completed` drains bounded batches without duplicate dispatch completion | P1 |
| SH-P2-10 | Medium | fixed locally; deploy verification needed | Public order detail now rate-limits before DB reads by token + client fingerprint: `thesmokehouse/app/api/orders/[public_token]/route.ts` | Leaked token or aggressive clients hammer order detail | Endpoint is protected from uncontrolled repeated DB reads | Deploy and verify normal order tracking still works while abusive polling returns 429 with `Retry-After` | P2 |
| SH-P2-11 | Medium | fixed locally; deploy verification needed | Public and signed JSON/form body readers now enforce streaming byte caps instead of trusting `Content-Length`: `thesmokehouse/lib/request-limits.ts`, `thesmokehouse/app/api/orders/route.ts`, `thesmokehouse/app/api/push/subscribe/route.ts`, `thesmokehouse/app/api/payments/pesapal/ipn/route.ts` | Chunked oversized JSON/form payloads hit public/signed endpoints | Oversized payloads should stop during stream read with 413 before full parse | Deploy and verify chunked oversized checkout/push/IPN bodies return 413 while normal bodies still pass | P2 |
| SH-P2-12 | Medium | fixed locally; live migration verification needed | Phase 43 drops authenticated direct-write policies and revokes anon/authenticated DML on business-truth tables: `thesmokehouse-admin/db/phase-43-rpc-only-business-truth-rls.sql`, `thesmokehouse-admin/db/merged-live-schema.sql` | Buggy/malicious admin client bypasses server actions | Direct browser-authenticated mutation of orders/payment/stock truth should be blocked; service-role server actions/RPCs still mutate | Apply Phase 43, verify staff reads still work, direct authenticated writes fail, and server actions/RPCs still succeed | P1 |
| SH-P2-13 | Medium | fixed locally; live migration verification needed | Phase 44 adds an admin/manager-only business-truth health snapshot and `/orders` renders it only for elevated roles: `thesmokehouse-admin/db/phase-44-business-truth-health-snapshot.sql`, `thesmokehouse-admin/app/(admin)/orders/page.tsx`, `thesmokehouse-admin/components/orders/business-truth-health-card.tsx` | Payment/stock drift exists but staff only see operational order cards | Admins can miss paid-stock conflicts, unpaid kitchen flow, cancelled-provider-paid conflicts, and stale recovery rows until a customer complains | Apply Phase 44, verify admin/manager can see the snapshot, regular staff cannot load it, and live counts match manual SQL spot checks | P2 |

## Peak Traffic Hot Path Map

| Path | Reads / Writes / RPCs | Caps / Limits | Rush Verdict |
|---|---|---|---|
| Homepage/menu + `/api/menu` | menu_items read plus daily_stock and finished_stock reads | no route rate, no cache, active menu rows uncapped | BROKEN under heavy browse |
| `/api/orders` | rate RPC x2, menu read, stock reads, order/items writes, payment_attempts, Pesapal | 32KB, 50 lines, qty max 20, DB rate limit | DANGEROUS: no idempotency or hold |
| Checkout stock validation | stock snapshot reads only | no reservation; storefront count at <=20; admin warnings at <=30/<=20/<=15 | DANGEROUS for popular low stock; mitigated operationally, not prevented |
| Pesapal status | order access read plus possible provider status plus mark paid RPC | 18/min/IP-UA | DEGRADED |
| Callback/IPN | rate RPC plus provider status plus mark paid RPC | 30/min and 60/min, not tracking-bucketed | DANGEROUS |
| Order tracking | two order reads, recovery kick | client poll capped; server detail route unrated | DEGRADED |
| Push subscribe | access read plus subscription upsert | 16KB, same-origin, route/order rate | SAFE-ish |
| Admin dashboard/orders | capped 50/100 orders, but many supporting queries | auth, no route rate | DEGRADED under many devices |
| Admin realtime reconciliation | per event per device detail fetch | per-order debounce only | DEGRADED/BROKEN at rush fanout |
| Push queues | claim RPCs, bounded batches | bounded but opportunistic/manual | DEGRADED |

## Stock Correctness Matrix

| Question | Answer | Evidence / Note |
|---|---|---|
| Does stock deduct only after verified payment? | Yes locally | `mark_order_as_paid` calls `reserve_paid_order_stock` after provider-paid verification |
| Does stock deduct exactly once? | Likely locally | order row `for update` plus `stock_reserved_at` guard |
| Can money be accepted without fulfillable stock? | Yes | no pre-payment hold; paid deduction can fail |
| Can finished_stock drift from daily_stock? | Needs verification | local Phase 44 adds admin/manager-only drift detection; Supabase rollout and live counts still need verification |
| Can stock be double-consumed? | Unlikely locally | row locks and `stock_reserved_at` guard |
| Can stock be wrongly returned after cancellation? | Paid stock is not returned locally | Phase 35 `release_reserved_order_stock` returns early when payment is paid |
| Do all stock-changing ops write audit rows? | Partial | paid finished_stock writes movement rows; daily_stock reserved/sold changes are less independently auditable |
| Does review block kitchen movement? | Yes locally | `transition_order_status` blocks prep/ready/completed on `fulfillment_review_required` or missing stock reservation |

## Payment Correctness Matrix

| Scenario | Class | Notes |
|---|---|---|
| Duplicate callback + duplicate IPN | SAFE for double-deduct, DEGRADED for rate | payment/stock idempotent locally; provider burst can hit 429 |
| Provider paid after local cancelled | SAFE-ish locally | `mark_order_as_paid` restores cancelled paid orders to confirmed |
| Provider pending/failed after local cancelled | SAFE-ish | local cancelled is preserved for non-paid statuses |
| Payment succeeds but stock fails | DEGRADED/DANGEROUS | order becomes paid with fulfillment review; money accepted without stock |
| Manual admin reverify | SAFE-ish | routes through signed storefront authority path |
| Customer closes browser after payment | DEGRADED | relies on callback/IPN/opportunistic recovery, not durable scheduler |
| Pending recovery after low traffic | DANGEROUS | in-memory, low batch, lookback-limited |

## Realtime Rush Matrix

| Area | Class | Notes |
|---|---|---|
| Shared realtime manager | SAFE-ish | one channel per browser manager |
| Many admin devices | DEGRADED | each device still performs reconciliation fetches |
| Many order item updates | DEGRADED/BROKEN | order_items events trigger per-order reconciliation |
| Fallback polling | DEGRADED | 10s fallback exists, but main dashboard/orders set `refreshOnFallback: false` |
| Hidden tabs | DEGRADED | no hidden-tab pause for realtime events/reconciliation |
| Admin processing without realtime | DEGRADED | pages still server-render and can refresh manually |

## Queue Backlog Matrix

| Queue | Class | Notes |
|---|---|---|
| Admin paid-order push queue | DEGRADED locally mitigated | durable table and claim RPC exist; local processor now caps to 10 active staff subscriptions, sends with concurrency 5, and processes dispatches with concurrency 3. Needs production queue-log verification |
| Customer Ready push queue | DEGRADED locally mitigated | durable dispatches and claims exist; local due scan now claims 10 with dispatch concurrency 3 and send concurrency 5. Needs live backlog/log verification |
| Duplicate notifications | SAFE-ish | dispatch uniqueness/receipts/tags reduce duplicate risk |
| No-subscriber behavior | DEGRADED | admin no-subscriber is retryable; customer no-subscription completes with last_error |
| Manual recovery | SAFE-ish | admin page has manual queue processing actions |
| No cron dependency | DEGRADED | no cron required, but low traffic can strand work without manual action |

## Public Endpoint Abuse Matrix

| Endpoint | Abuse / Rush Risk | Current Control | Verdict |
|---|---|---|---|
| `/api/menu` | high browse volume | none found | HIGH |
| `/api/orders` | duplicate submit, large cart, stock race | DB rate limits, 32KB, zod, item normalization | HIGH |
| `/api/payments/pesapal/status` | polling hammer | DB rate limit 18/min/IP-UA | MEDIUM |
| `/api/payments/pesapal/callback` | provider duplicate bursts | DB rate limit 30/min/IP-UA | X-HIGH |
| `/api/payments/pesapal/ipn` | provider duplicate bursts, body | DB rate limit 60/min/IP-UA, 16KB for POST | X-HIGH |
| `/api/orders/[public_token]` | token hammer | access check, no rate | MEDIUM |
| `/api/push/subscribe` | subscription spam | same-origin, DB rate limits, 16KB, VAPID key check | LOW/MEDIUM |
| Admin JSON endpoints | many logged-in devices | auth, caps, no route-level rate | MEDIUM |

## PWA Stale-Client Matrix

| Area | Verdict | Notes |
|---|---|---|
| Service worker API caching | SAFE | `/api` GETs are excluded from SW cache |
| Checkout/order dynamic pages | SAFE-ish | `/checkout` and `/order/*` restricted from navigation cache |
| Stale checkout payloads | SAFE-ish | API zod rejects invalid structure; backend still needs compatibility discipline |
| Version freshness | DEGRADED | banner exists, but not enough for critical backend contract changes |
| Payment/order pages cached incorrectly | SAFE locally | API no-store; SW excludes APIs and dynamic order pages |
| Notification click URLs | SAFE | Ready push opens exact `/order/{public_token}` |

## Direct Correctness Answers

| Question | Answer |
|---|---|
| Can money be accepted without fulfillable stock? | Yes. Confirmed. |
| Can `finished_stock` drift from `daily_stock`? | Likely controlled on paid path; local Phase 44 now detects drift, but live rollout and counts still need verification. |
| Can stock be double-consumed? | Locally unlikely because order row lock plus `stock_reserved_at` guard. |
| Can stock be wrongly returned after cancellation? | Paid stock is not returned in Phase 35; live rollout needs verification. |
| Can an order become paid but invisible to staff? | Yes, if callback/recovery/queue paths fail or migration/env is missing. |
| Can an unpaid order enter prep/ready/completed? | DB RPC blocks it locally, assuming live RPC is deployed and used. |
| Can manual reverify contradict callback/IPN logic? | Unlikely locally; it routes through the same storefront authority path. |

## Final Action Plan

### Must Fix Before Live Traffic

1. Add checkout idempotency and atomic order/items creation.
2. Decide and implement stock hold strategy or explicit paid-unfulfillable refund/review policy.
3. Harden Pesapal callback/IPN limits by tracking/reference and make IPN ACK plus queued verification.
4. Add durable payment recovery that does not depend on cron or low-traffic page hits.
5. Cache or collapse `/api/menu`.

### Must Fix Before Marketing Push

1. Batch admin realtime reconciliation and pause hidden tabs.
2. Replace queue health multi-count reads with one RPC.
3. Verify admin/manager-only stock/payment reconciliation views after Phase 44 rollout.

### Should Fix After Launch

1. Add load tests for 200 menu reads, 50 checkout submits, duplicate callbacks, and 20 same-item payments.

### Monitor Only

1. VAPID/env drift, but only after live env values are verified.
2. Paid cancellation stock semantics, if the business accepts "paid stock never returns."
