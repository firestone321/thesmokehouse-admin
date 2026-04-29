# Smokehouse Paranoid Performance And Security Review

Review date: 2026-04-29

Scope:

- Admin dashboard repo: `C:\Users\Jurugo\OneDrive\VS Code\Web Development\thesmokehouse-admin`
- Storefront repo: `C:\Users\Jurugo\OneDrive\VS Code\Web Development\thesmokehouse`
- Reference repos: `kira_bakery`, `kira-bakery-admin`
- Constraint: avoid cron jobs where possible because the current deployment target is Vercel Hobby

Important scope note:

- This is a local code and schema audit. It does not prove what is deployed.
- "Implemented locally" is not safe until the relevant migration, environment variables, and deployment are verified in Supabase/Vercel.
- This review assumes hostile traffic, Vercel multi-instance behavior, delayed provider events, stale clients, and repeated invalid requests.

## A. Executive Summary

The platform has several good durability ideas, but it is not load-ready yet.

The most dangerous confirmed issue is stock truth drift: fulfilled orders update `daily_stock`, but the durable `finished_stock.current_quantity` source does not appear to be decremented on reservation, cancellation, or sale finalization. Because storefront stock falls back to `finished_stock` when a daily row is missing, old frozen stock can be advertised again on a later service day. That can sell inventory that no longer exists.

The second major class is access and abuse hardening. The admin app uses service-role server actions for operational mutations, but the app/action layer does not consistently verify the Smokehouse profile role before using the service role. RLS is bypassed by design once service-role clients are used. Public storefront routes also still depend on in-memory rate limits or no rate limits, which is unsafe on Vercel multi-instance serverless.

Payment correctness is improved by the local Phase 29 pending recovery patch, but it is still not production-safe until deployed and verified. The no-cron model also means recovery can stall during low-traffic periods unless more event triggers or manual retry surfaces are added.

Blunt answer to the load question:

- Money can be taken for stock that cannot be reserved. Phase 27 surfaces this as review, so payment truth is preserved, but staff still need manual fulfillment resolution.
- Stock can become inconsistent across days because `finished_stock` is not consumed by completed sales.
- Paid orders are unlikely to fully disappear after Phase 27, but they can get stuck in review, pending recovery, or push backlog.
- Unpaid orders are blocked from kitchen progression at the DB transition function, but service-role admin actions must still be role-guarded.
- Abuse can make the platform expensive because public route rate limiting is not shared and some routes parse bodies before rate limiting.
- Low traffic can delay no-cron recovery and retry queues.

## B. Severity Table

| Severity | ID | Title | Status |
| --- | --- | --- | --- |
| Critical | C-01 | `finished_stock` is not consumed by sales, allowing cross-day stock drift | confirmed |
| X-High | XH-01 | Admin service-role mutations are not consistently role-checked at the app layer | confirmed |
| X-High | XH-02 | Public abuse controls are not serverless-safe and parse some payloads too late | confirmed |
| High | H-01 | Pending payment recovery is local-only until Phase 29 and can stall in low traffic | confirmed |
| High | H-02 | Late non-paid Pesapal verification could overwrite local `cancelled` back to `pending` | fixed locally, verify before rollout |
| High | H-03 | Customer order/payment reads rely too heavily on bearer public tokens | confirmed |
| High | H-04 | Admin realtime fallback can cause repeated full server refreshes across devices | confirmed |
| Medium | M-01 | Admin order/dashboard queries are unbounded | confirmed |
| Medium | M-02 | Admin push routes are authenticated but not role-checked or rate-limited | confirmed |
| Medium | M-03 | Payment callback/IPN/status routes lack bakery-style shared rate limits and security logs | confirmed |
| Medium | M-04 | No-cron push retries can stall without later traffic or manual retry | confirmed |
| Medium | M-05 | Admin push environment requirements are easy to misconfigure | needs verification |
| Medium | M-06 | Core RPC execute privileges are not explicitly revoked | needs verification |
| Low | L-01 | Client IP handling is weaker than bakery's trusted-proxy helper | confirmed |
| Low | L-02 | Storefront menu reads are dynamic and duplicate stock/menu queries under load | confirmed |
| Low | L-03 | Admin verification is blocked by stale generated `.next` types | confirmed |
| Low | L-04 | Login has no app-level pre-auth throttling | confirmed |

## C. Findings

### C-01: `finished_stock` is not consumed by sales, allowing cross-day stock drift

Severity: Critical

Status: confirmed

Affected repo:

- `thesmokehouse-admin`
- `thesmokehouse`

Affected files/functions/routes:

- `thesmokehouse-admin/db/merged-live-schema.sql:2098` `public.reserve_paid_order_stock(...)`
- `thesmokehouse-admin/db/merged-live-schema.sql:2201` `public.release_reserved_order_stock(...)`
- `thesmokehouse-admin/db/merged-live-schema.sql:2253` `public.finalize_reserved_order_sale(...)`
- `thesmokehouse-admin/db/merged-live-schema.sql:2155-2180` daily-stock reservation seeded from `finished_stock.current_quantity`
- `thesmokehouse-admin/db/merged-live-schema.sql:2287-2290` completed sale moves `reserved_quantity` to `sold_quantity`
- `thesmokehouse/lib/menu-stock.ts:63-81` storefront prefers today's `daily_stock`, then falls back to `finished_stock`
- `thesmokehouse/lib/menu-stock.ts:109-119` storefront reads both `daily_stock` and `finished_stock`

Evidence:

- Reservation locks and checks `finished_stock.current_quantity`, then inserts a `daily_stock` row with `starting_quantity = v_finished_stock.current_quantity` when no daily row exists.
- Finalization updates only `daily_stock.reserved_quantity` and `daily_stock.sold_quantity`.
- Search found no matching decrement of `public.finished_stock.current_quantity` in reservation or finalization.
- Storefront stock fallback uses `finished_stock.current_quantity` when no same-day `daily_stock` row exists.

Failure scenario:

1. Finished stock says 10 portions.
2. Day 1 has no `daily_stock` row, so first paid reservation seeds daily stock from finished stock.
3. Orders complete. `daily_stock.sold_quantity` increases.
4. `finished_stock.current_quantity` still says 10.
5. Day 2 has no `daily_stock` row, storefront falls back to finished stock and shows 10 portions again.
6. Customers can pay for stock that was already sold.

Production impact:

- Money can be accepted for unavailable stock.
- Staff see paid orders requiring manual resolution.
- Inventory reports become untrustworthy across days.
- Food-safety batch traceability is weakened because sale consumption is not tied back to finished-stock movement.

Bakery comparison:

- Bakery's paid inventory work is built around payment truth plus inventory review state. The key missing Smokehouse piece is not the paid-review concept; it is durable finished-stock depletion.

Exact fix recommendation:

- Decide the canonical model:
  - Option A: `finished_stock` is the durable stock ledger and must be decremented atomically when stock is allocated into `daily_stock`.
  - Option B: `daily_stock` is a daily allocation ledger, and an explicit "post to service day" function moves units out of `finished_stock` into `daily_stock`.
- Do not let reservation silently seed `daily_stock` from full `finished_stock.current_quantity` without decrementing or marking allocation.
- Add `finished_stock_movements` rows for allocation, sale finalization, cancellation release, waste, and manual adjustment.
- Backfill/reconcile live `finished_stock` against completed orders before trusting storefront stock.

Suggested implementation order:

1. Freeze stock-affecting rollout until the model is fixed.
2. Add a Phase 30 stock allocation/depletion migration.
3. Update reservation/finalization/release functions.
4. Add reconciliation SQL to detect `finished_stock` quantities inconsistent with completed sales.
5. Verify same-day and next-day checkout simulations.

### XH-01: Admin service-role mutations are not consistently role-checked at the app layer

Severity: X-High

Status: confirmed

Affected repo:

- `thesmokehouse-admin`

Affected files/functions/routes:

- `app/(admin)/layout.tsx:19-23`
- `proxy.ts:44-53`
- `lib/ops/actions.ts:43`, `100`, `232`, `340`, `362`, `407`, `452`, `504`, `654`, `775`, `859`, `904`, `953`
- `app/api/admin/push/subscriptions/route.ts:43-56`
- `app/api/admin/push/process/route.ts:5-19`
- `lib/supabase/server.ts:7-13`
- `db/phase-22-admin-rls-lockdown.sql:135-442`

Evidence:

- Admin layout checks only `supabase.auth.getUser()` before rendering the admin shell.
- Server actions call `createAdminSupabaseClient()` and then mutate operational tables or call RPCs with service-role privileges.
- Admin push API routes check for a Supabase user session but do not verify `profiles.role`.
- Phase 22 defines role-aware RLS policies, but service-role clients bypass RLS.

Failure/exploit scenario:

1. A non-staff Supabase Auth user exists in the project, or a future customer-auth feature shares the same Supabase Auth project.
2. That user can authenticate.
3. The layout/proxy sees a valid user session.
4. If the user can invoke server actions or admin API routes, the app server uses service role and bypasses RLS.
5. Inventory, procurement, menu, and order mutations can happen without a profile-role check at the app boundary.

Production impact:

- Unauthorized operational mutation if auth roster ever includes non-admin users.
- Admin push subscription abuse: an authenticated but non-staff user could register a push endpoint and receive paid-order notifications.
- RLS gives a false sense of safety for service-role code paths.

Bakery comparison:

- Bakery audit memories and code patterns emphasize admin-route hardening and role checks before privileged operations.

Exact fix recommendation:

- Add a central `requireAdminRole(...)` server helper.
- Use it at the top of every server action and admin API route before creating a service-role client.
- Link admin push subscriptions to the authenticated profile/user id.
- Send admin push notifications only to currently authorized admin/staff profiles.
- Keep RLS, but do not rely on RLS for service-role route/action authorization.

Suggested implementation order:

1. Add `requireAdminRole(["admin", "manager", "staff"])`.
2. Patch all `lib/ops/actions.ts` exports.
3. Patch `/api/admin/push/*`.
4. Patch admin layout to reject users without a profile role.
5. Add a negative test using an authenticated no-role user.

### XH-02: Public abuse controls are not serverless-safe and parse some payloads too late

Severity: X-High

Status: confirmed

Affected repo:

- `thesmokehouse`

Affected files/functions/routes:

- `app/api/orders/route.ts:34-47`
- `lib/rate-limit.ts:12-16`, `39-54`
- `app/api/payments/pesapal/status/route.ts:4-25`
- `app/api/payments/pesapal/callback/route.ts:9-47`
- `app/api/payments/pesapal/ipn/route.ts:55-82`
- `app/api/push/subscribe/route.ts:17-24`, `68-81`

Evidence:

- Checkout parses JSON at `app/api/orders/route.ts:35` before zod validation and before rate limiting.
- Checkout rate limiting uses process-local `Map` objects in `lib/rate-limit.ts`.
- Push subscribe uses a route-local `Map`.
- Payment status/callback/IPN routes have no shared rate limit in Smokehouse.

Failure/exploit scenario:

1. Attacker sends large or invalid JSON payloads to `/api/orders`.
2. App parses before rate limiting and validation.
3. Vercel scales to multiple instances; each instance has its own in-memory map.
4. Attacker repeatedly hits payment status/callback/IPN routes with invalid identifiers.
5. Supabase and Pesapal verification work increases while app-level limits do not coordinate.

Production impact:

- Higher Vercel function invocations.
- Higher Supabase read/write load.
- Potential Pesapal status endpoint pressure.
- Higher cold-start amplification during bursts.

Bakery comparison:

- Bakery has `public.api_rate_limits` and `public.consume_rate_limit(...)` in `kira_bakery/supabase/migrations/202603180005_shared_rate_limit_store.sql:3-84`.
- Bakery uses `enforceRateLimit(...)` through `kira_bakery/lib/rate-limit.ts:78-99`.
- Bakery checkout checks `Content-Length` before parsing at `kira_bakery/app/api/checkout/route.ts:895-908`.
- Bakery payment status/callback/IPN routes are rate-limited at `kira_bakery/app/api/payments/pesapal/status/route.ts:23`, `callback/route.ts:27`, and `ipn/route.ts:76`.

Exact fix recommendation:

- Port bakery's Supabase-backed shared rate-limit table and RPC.
- Check `Content-Length` before `req.json()` on checkout and internal JSON routes.
- Apply route limits to checkout, order detail, payment status, callback, IPN, push subscribe, menu if abuse appears, and admin push routes.
- Use trusted proxy IP handling.

Suggested implementation order:

1. Add `api_rate_limits` migration and helper.
2. Patch `/api/orders` to rate-limit and size-check before parsing.
3. Patch payment routes.
4. Patch push subscribe.
5. Patch admin push routes.

### H-01: Pending payment recovery is local-only until Phase 29 and can stall in low traffic

Severity: High

Status: confirmed

Affected repo:

- `thesmokehouse`
- `thesmokehouse-admin`

Affected files/functions/routes:

- `thesmokehouse/lib/payments/order-payments.ts:49-56`, `734-831`
- `thesmokehouse/app/api/payments/pesapal/status/route.ts:20-22`
- `thesmokehouse/app/api/orders/[public_token]/route.ts:73-75`
- `thesmokehouse/app/api/payments/pesapal/callback/route.ts:44-46`
- `thesmokehouse/app/api/payments/pesapal/ipn/route.ts:80-82`
- `thesmokehouse-admin/db/phase-29-pending-payment-recovery.sql`

Evidence:

- Local patch adds a 7-minute tracked recovery and 15-minute untracked timeout.
- Recovery is only triggered by request events.
- No cron or background worker is present by design.

Failure/exploit scenario:

1. Order is created and customer leaves.
2. Pesapal callback/IPN never arrives.
3. No one opens status/order tracking and no later payment route traffic occurs.
4. Pending recovery does not run.
5. Order remains pending until the next triggering request.

Production impact:

- Pending rows can linger during low traffic.
- Staff may see fewer stale rows after cleanup eventually runs, but not immediately.
- This is safer than cron for Hobby cost, but weaker than a guaranteed scheduler.

Bakery comparison:

- Bakery uses the same event-driven recovery concept, but with more trigger points and richer access/session plumbing.

Exact fix recommendation:

- Keep no-cron, but add more safe triggers: checkout start, menu load after response, order page load, admin dashboard load, and admin manual "process recovery" action.
- Add a small authenticated admin recovery endpoint/button.
- Log recovery stats.

Suggested implementation order:

1. Deploy Phase 29.
2. Add admin manual recovery kick.
3. Add status metrics for pending older than 7/15 minutes.

### H-02: Late non-paid Pesapal verification could overwrite local `cancelled` back to `pending`

Severity: High

Status: fixed locally, verify before rollout

Affected repo:

- `thesmokehouse`

Affected files/functions/routes:

- `lib/payments/order-payments.ts:510-570`
- `lib/payments/order-payments.ts:543`

Evidence:

- Before the local fix, `syncPesapalPaymentForOrder(...)` wrote `payment_status: status.paymentStatus` for non-paid provider results.
- That did not guard against a locally cancelled order.
- The first Phase 29 pass fixed `paid` overriding cancelled, but still left `pending` or `failed` provider statuses able to overwrite a local cancellation.
- The storefront helper now preserves local `cancelled` for non-paid provider statuses while still allowing `paid` to flow through `mark_order_as_paid(...)`.

Failure/exploit scenario:

1. Local recovery soft-cancels a stale pending tracked order.
2. Later callback/IPN/status verification sees Pesapal still `INVALID`/pending.
3. `syncPesapalPaymentForOrder(...)` updates `payment_status` back to `pending`.
4. `orders.status` remains `cancelled`.
5. Customer/admin state becomes contradictory.

Production impact:

- Confusing status display.
- Support friction.
- Possible repeated polling of orders that should be terminal.

Bakery comparison:

- Bakery's payment persistence logic is more explicit about stored status, verified status, forced paid recovery, and soft-cancel boundaries.

Exact fix recommendation:

- In `syncPesapalPaymentForOrder(...)`, only `paid` may override `cancelled`.
- Non-paid provider results should update audit fields but not revive a locally terminal cancelled payment.
- Add a regression case: cancelled + provider pending remains cancelled; cancelled + provider paid restores confirmed/paid.

Suggested implementation order:

1. Run storefront TypeScript/build verification.
2. Add sandbox/manual test.

### H-03: Customer order/payment reads rely too heavily on bearer public tokens

Severity: High

Status: confirmed

Affected repo:

- `thesmokehouse`

Affected files/functions/routes:

- `app/api/payments/pesapal/status/route.ts:4-25`
- `app/api/orders/[public_token]/route.ts:39-64`
- `lib/order-access.ts:82-116`

Evidence:

- Payment status accepts `token` and returns order/payment details.
- Order detail grants access based on `public_token` possession and then sets the signed access cookie.
- Signed order access exists, but it is not required for the initial detail/status read.

Failure/exploit scenario:

1. A customer shares a screenshot, URL, browser history, or support transcript containing the token.
2. Another person polls payment/order routes with that token.
3. They can view order status and customer details.

Production impact:

- Privacy leak, not direct stock/payment mutation.
- Support risk around pickup code/order details.

Bakery comparison:

- Bakery payment status uses order access cookies and signed access links at `kira_bakery/app/api/payments/pesapal/status/route.ts:55-113`.
- Bakery order detail route requires access at `kira_bakery/app/api/orders/[id]/route.ts:26-78`.

Exact fix recommendation:

- Move Smokehouse to `orderId + signed access token`.
- Allow public token only to bootstrap a short-lived signed session once.
- Require order access cookie for repeated status/detail reads.
- Add security-event logging for invalid/missing access.

Suggested implementation order:

1. Port bakery order-access-link pattern.
2. Update checkout/payment result URLs.
3. Keep backwards compatibility for old links with bootstrap redirect.

### H-04: Admin realtime fallback can cause repeated full server refreshes across devices

Severity: High

Status: confirmed

Affected repo:

- `thesmokehouse-admin`

Affected files/functions/routes:

- `lib/ops/orders-realtime.ts:6-7`, `99-132`, `173-181`
- `components/ops/use-orders-realtime.ts:17-33`
- `lib/ops/queries.ts:499-553`
- `lib/ops/queries.ts:1233-1289`

Evidence:

- Realtime manager subscribes to all order and order item inserts/updates/deletes.
- On fallback it polls every 10 seconds.
- Each refresh calls `router.refresh()`.
- Orders and dashboard server queries are unbounded.

Failure/exploit scenario:

1. Several admin tablets are open.
2. Supabase realtime times out or reconnects repeatedly.
3. Each device starts fallback polling.
4. Each poll triggers a full RSC refresh.
5. Full refresh runs unbounded order/dashboard queries.

Production impact:

- Serverless invocation multiplication.
- Supabase query pressure.
- Admin dashboard can feel slow during exactly the moments staff need it.

Bakery comparison:

- Bakery admin clamps order list reads with `DEFAULT_ORDER_LIST_LIMIT = 50` and `MAX_ORDER_LIST_LIMIT = 100` in `kira-bakery-admin/src/lib/supabase/queries.ts:75-79`.

Exact fix recommendation:

- Cap admin reads first.
- Add exponential backoff and jitter to realtime fallback polling.
- Pause polling on hidden tabs.
- Consider incremental fetch for recent order changes instead of full page refresh.

Suggested implementation order:

1. Add order/dashboard limits.
2. Add polling backoff.
3. Add visibility-state pause.

### M-01: Admin order/dashboard queries are unbounded

Severity: Medium

Status: confirmed

Affected repo:

- `thesmokehouse-admin`

Affected files/functions/routes:

- `lib/ops/queries.ts:499-553`
- `lib/ops/queries.ts:1233-1289`

Evidence:

- `getOrdersPageData(...)` orders by `created_at` without `.limit(...)`.
- Dashboard loads active orders and today's orders without limits.

Failure/exploit scenario:

- Order history grows; every admin refresh pulls more rows and nested `order_items`.

Production impact:

- Gradual performance degradation.
- Realtime fallback amplifies cost.

Fix recommendation:

- Add server pagination for `/orders`.
- Cap dashboard rows and use counts/aggregates for totals.

Suggested implementation order:

- Fix immediately after C-01 and XH-01.

### M-02: Admin push routes are authenticated but not role-checked or rate-limited

Severity: Medium

Status: confirmed

Affected repo:

- `thesmokehouse-admin`

Affected files/functions/routes:

- `app/api/admin/push/subscriptions/route.ts:43-56`
- `app/api/admin/push/subscriptions/route.ts:65-87`
- `app/api/admin/push/process/route.ts:5-19`
- `lib/push/admin-paid-order-notifications.ts:107-116`

Evidence:

- `requireAdminSession()` checks only `auth.getUser()`.
- Subscription route stores endpoint via service role.
- Queue processing route has no rate limit.
- Admin push delivery lists all stored subscriptions.

Failure/exploit scenario:

- Any authenticated user in this Supabase project registers a push endpoint and receives paid-order notifications.
- Repeated process calls consume server work.

Production impact:

- Order privacy leak.
- Queue processing abuse.

Fix recommendation:

- Require profile role.
- Bind subscriptions to profile/user id.
- Rate-limit queue process route.

### M-03: Payment callback/IPN/status routes lack bakery-style shared rate limits and security logs

Severity: Medium

Status: confirmed

Affected repo:

- `thesmokehouse`

Affected files/functions/routes:

- `app/api/payments/pesapal/status/route.ts:4-25`
- `app/api/payments/pesapal/callback/route.ts:9-47`
- `app/api/payments/pesapal/ipn/route.ts:55-82`

Evidence:

- No `enforceRateLimit(...)` equivalent is present in these routes.
- No Smokehouse security-event logger is present.

Failure/exploit scenario:

- Invalid callbacks/IPNs and repeated status polling create repeated Supabase/Pesapal work.

Production impact:

- Increased costs and noise.
- Poor abuse observability.

Bakery comparison:

- Bakery logs and rate-limits these routes through `logSecurityEvent(...)` and `enforceRateLimit(...)`.

Fix recommendation:

- Port bakery security event helper.
- Rate-limit and log invalid/missing identifiers and access failures.

### M-04: No-cron push retries can stall without later traffic or manual retry

Severity: Medium

Status: confirmed

Affected repo:

- `thesmokehouse`
- `thesmokehouse-admin`

Affected files/functions/routes:

- `thesmokehouse/lib/push/order-ready.ts:29-34`, `203-213`, `358-386`
- `thesmokehouse/app/api/internal/push/order-ready/process/route.ts:22-57`
- `thesmokehouse-admin/lib/push/admin-paid-order-notifications.ts:5-7`, `170-184`, `332-352`
- `thesmokehouse-admin/app/api/admin/push/process/route.ts:18-19`

Evidence:

- Customer ready push scans only 2 due dispatches per event-driven kick.
- Admin push retries use bounded claim limits and retry delays.
- No autonomous scheduler exists.

Failure/exploit scenario:

- Push provider fails; dispatch is rescheduled.
- No later order, tracking, subscription, or admin process request happens.
- Retry waits indefinitely.

Production impact:

- Notifications can be delayed during low-traffic periods.
- Order state remains correct, but communication is degraded.

Fix recommendation:

- Keep no-cron, but add visible queue status and manual retry buttons.
- Add more harmless opportunistic triggers.
- Alert admins when dispatch backlog exceeds threshold.

### M-05: Admin push environment requirements are easy to misconfigure

Severity: Medium

Status: needs verification

Affected repo:

- `thesmokehouse-admin`

Affected files/functions/routes:

- `components/pwa/admin-push-auto-enrollment.tsx:37-77`
- `lib/public-env.ts:1-3`
- `lib/push/admin-paid-order-notifications.ts:196-198`

Evidence:

- Client enrollment needs `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`.
- Server delivery needs `WEB_PUSH_VAPID_SUBJECT`, `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, and `WEB_PUSH_VAPID_PRIVATE_KEY`.
- Earlier notes emphasized storefront VAPID variables but did not clearly list the admin `WEB_PUSH_*` names.

Failure scenario:

- Admin clients subscribe successfully in one environment but delivery fails in another because server env names are missing.

Production impact:

- Admin paid-order notifications silently degrade to queue failures/logs.

Fix recommendation:

- Add `.env.example` or deployment checklist for both apps.
- Add startup/config health check displayed to admin.

### M-06: Core RPC execute privileges are not explicitly revoked

Severity: Medium

Status: needs verification

Affected repo:

- `thesmokehouse-admin`

Affected files/functions/routes:

- `db/merged-live-schema.sql:244`, `590`, `703`, `838`, `1004`, `1304`, `1582`, `2098`, `2201`, `2253`, `2307`, `2501`

Evidence:

- Claim functions explicitly revoke execute from public/anon/authenticated and grant to service role.
- Core operational RPCs do not show equivalent revoke statements in the inspected merged schema.
- They are not `security definer`, so RLS likely blocks anon/authenticated direct abuse, but default function execute privileges should not be left implicit.

Failure scenario:

- A future `security definer` change or policy change could accidentally expose operational RPCs.

Production impact:

- Currently likely mitigated by RLS, but this is brittle.

Fix recommendation:

- Explicitly revoke core operational RPC execute from `public`, `anon`, and possibly `authenticated`.
- Grant only to intended roles or service-role-only call paths.

### L-01: Client IP handling is weaker than bakery's trusted-proxy helper

Severity: Low

Status: confirmed

Affected repo:

- `thesmokehouse`

Affected files/functions/routes:

- `lib/validation.ts:26`
- `lib/rate-limit.ts:39-54`

Evidence:

- Smokehouse uses the first `x-forwarded-for` value for checkout rate limiting.
- Bakery only trusts generic forwarding headers when known proxy markers are present in production.

Fix recommendation:

- Port bakery's trusted-proxy IP helper.

### L-02: Storefront menu reads are dynamic and duplicate stock/menu queries under load

Severity: Low

Status: confirmed

Affected repo:

- `thesmokehouse`

Affected files/functions/routes:

- `app/page.tsx:20-67`
- `app/api/menu/route.ts:18-58`
- `lib/menu-stock.ts:87-139`

Evidence:

- Homepage and menu API both dynamically query menu items plus daily/finished stock.
- No short TTL cache or per-request memoized shared loader is present.

Failure scenario:

- Marketing traffic repeatedly hits homepage and `/api/menu`.

Production impact:

- Supabase read load increases.
- Not a correctness issue.

Fix recommendation:

- Add a short TTL cache for menu metadata while keeping stock reads fresh or near-fresh.
- Split static menu metadata from fast stock availability.

### L-03: Admin verification is blocked by stale generated `.next` types

Severity: Low

Status: confirmed

Affected repo:

- `thesmokehouse-admin`

Evidence:

- Admin `npx.cmd tsc --noEmit` failed on `.next/types/validator.ts` referencing `../../app/api/app-version/route.js`.

Fix recommendation:

- Clear/regenerate `.next` before final verification.

### L-04: Login has no app-level pre-auth throttling

Severity: Low

Status: confirmed

Affected repo:

- `thesmokehouse-admin`

Affected files/functions/routes:

- `lib/auth/actions.ts:24-36`

Evidence:

- Password sign-in calls Supabase Auth directly without an app-level rate limit.

Production impact:

- Supabase likely has its own protection, but app-level logging/throttling would improve abuse visibility.

Bakery comparison:

- Bakery audit hardening includes pre-auth throttling patterns.

Fix recommendation:

- Add a conservative shared rate limit before login attempts.

## D. Required Maps And Matrices

### API Route Exposure Map

| Route | Repo | Exposure | Current guard | Main risk |
| --- | --- | --- | --- | --- |
| `GET /api/menu` | storefront | public | none | read load, no cache |
| `POST /api/orders` | storefront | public | zod + in-memory rate after parse | abuse, oversized body, checkout bursts |
| `GET /api/orders/[public_token]` | storefront | bearer link | public token, then sets cookie | leaked token privacy |
| `GET /api/payments/pesapal/status` | storefront | public/bearer token | token only | polling abuse, privacy |
| `GET /api/payments/pesapal/callback` | storefront | public/provider | provider status verification later | no shared rate/logging |
| `GET/POST /api/payments/pesapal/ipn` | storefront | public/provider | provider status verification later | no shared rate/logging |
| `POST /api/push/subscribe` | storefront | public with order cookie | same-origin + order access + in-memory rate | serverless rate bypass |
| `POST /api/internal/push/order-ready/process` | storefront | internal | signed bearer token | parses before auth, no rate |
| `GET /api/app-version` | storefront | public | no-store | low risk |
| `POST /api/admin/push/subscriptions` | admin | authenticated | auth user only | no role check |
| `POST /api/admin/push/process` | admin | authenticated | auth user only | no role check/rate |

### Public Route Rate-Limit Map

| Route | Current limit | Vercel-safe? | Verdict |
| --- | --- | --- | --- |
| `/api/orders` | process-local IP/phone map | no | broken under multi-instance |
| `/api/payments/pesapal/status` | none | no | high abuse risk |
| `/api/payments/pesapal/callback` | none | no | medium abuse risk |
| `/api/payments/pesapal/ipn` | none | no | medium abuse risk |
| `/api/push/subscribe` | process-local map | no | bypassable |
| `/api/menu` | none | no | acceptable only with low traffic |
| `/api/internal/push/order-ready/process` | signed token, no rate | partly | size/rate hardening missing |

### Payment Failure Matrix

| Case | Current behavior | Classification |
| --- | --- | --- |
| Payment succeeds, stock reserves | paid -> confirmed, stock reserved | SAFE |
| Payment succeeds, stock insufficient | paid preserved, review required | DEGRADED |
| Payment succeeds after local soft-cancel | Phase 29 restores `cancelled -> confirmed` if deployed | DEGRADED until deployed |
| Provider pending after local soft-cancel | can rewrite payment status to pending | BROKEN |
| Duplicate callback/IPN after paid | mostly idempotent via `mark_order_as_paid` | SAFE |
| Callback/IPN invalid spam | provider verification/routing cost, no shared limit | DEGRADED |
| User closes browser after payment | IPN/callback/status can recover; if none arrive, waits for traffic | DEGRADED |
| Payment initiation fails before tracking id | local rejection cancels if known; network timeout leaves pending until recovery | DEGRADED |

### Stock Race-Condition Matrix

| Case | DB behavior | Classification |
| --- | --- | --- |
| Same-day low-stock concurrent reservation | row locks + accounting check protect `daily_stock` | SAFE |
| Multi-item order reservation | ordered by `portion_type_id` | SAFE for deadlock avoidance |
| Paid stock reservation failure | payment preserved, review surfaced | DEGRADED |
| Complete order | daily reserved -> sold | SAFE for daily row |
| Cancel reserved order | daily reserved released | SAFE for daily row |
| Cross-day sale depletion | `finished_stock` not decremented | DANGEROUS |
| Manual finished stock adjustments | possible, but drift detection not automatic | DEGRADED |
| Fries/drinks direct sellable intake | adds stock and movement | SAFE only if sale depletion fixed |

### Realtime/Load Risk Map

| Path | Risk |
| --- | --- |
| Orders realtime channel | one browser-side manager per app instance, good baseline |
| Multiple admin devices | each device refreshes independently |
| Realtime error fallback | 10-second polling triggers full `router.refresh()` |
| Dashboard refresh | unbounded active/today order reads |
| Orders refresh | unbounded order list |
| Reconnect storm | expensive but data integrity preserved |

### Push Queue Durability Map

| Queue | Durable row? | Claim limit | Retry | Stall risk |
| --- | --- | --- | --- | --- |
| Customer Ready push | yes | scans 2 per event kick | exponential up to 5 attempts | yes, no traffic means no retry |
| Admin paid-order push | yes | max 25, route uses 5 | 6 attempts up to 2 hours | yes, no admin/process kick means delay |

### Service Worker Cache Safety Map

| App | Evidence | Verdict |
| --- | --- | --- |
| Storefront | skips `/api`, excludes `/checkout` and `/order/*`, caches `/`, `/cart`, `/offline` | mostly SAFE |
| Storefront freshness | event-based `/api/app-version`, banner reload | DEGRADED if user ignores banner |
| Admin | network-first navigations, caches static assets/offline only | mostly SAFE |
| Old checkout logic | stale JS can survive until refresh | DEGRADED |

### Supabase RLS/RPC Safety Map

| Surface | Current state | Verdict |
| --- | --- | --- |
| Admin tables | RLS enabled with admin role policies | good for direct client access |
| Service-role server actions | bypass RLS, no central role check | X-HIGH |
| Profiles role escalation | profile updates admin-only in RLS | good if app role gate is enforced |
| SECURITY DEFINER helpers | role/claim helpers set `search_path`; claim functions revoke execute | good |
| Core RPC execute grants | not explicitly revoked in merged schema | needs hardening |
| Storefront direct table access | server service-role API only | safe only if route validation is strong |

### No-Cron Reliability Map

| Process | Trigger points | Low-traffic behavior | Verdict |
| --- | --- | --- | --- |
| Pending payment recovery | status, order tracking, callback, IPN | stalls until next trigger | DEGRADED |
| Customer Ready push | ready transition, tracking, subscribe | retry stalls until trigger | DEGRADED |
| Admin paid push | order payment transition, subscribe/process | retry stalls until admin/process | DEGRADED |
| Storefront freshness | app open, tab active, SW update | no forced refresh | SAFE but user-dependent |

## E. Load And Failure Simulation

### A. 50-200 concurrent checkouts

What happens:

- Each checkout parses JSON, validates menu, reads stock maps, inserts order/items, then initiates Pesapal.
- Rate limiting is per-instance memory.

Break point:

- Supabase and Pesapal initiation load; in-memory limits fail across instances.

Visibility:

- Some users see checkout/payment errors; staff may see pending rows.

Integrity:

- Payment-before-reservation avoids unpaid reservation, but stock is not held until payment.

Recovery:

- Pending recovery is event-driven.

Classification: DEGRADED, potentially BROKEN under abuse.

### B. Multiple users buying the same low-stock item

What happens:

- Checkout validation can pass for many users because stock is not reserved until payment.
- Paid reservation then serializes through DB locks.

Break point:

- Later paid orders may fail stock reservation after money is accepted.

Visibility:

- Admin review state if Phase 27 is deployed.

Integrity:

- Same-day oversell prevented; customer promise degraded.

Recovery:

- Manual fulfillment review.

Classification: DEGRADED.

### C. Payment succeeds but stock is insufficient

Classification: DEGRADED.

- Money is preserved as paid.
- Order enters fulfillment review.
- Staff must resolve manually.
- Data integrity is preserved better than rolling payment back.

### D. Pesapal callback delayed 5-15 minutes

Classification: DEGRADED.

- If the local 7-minute soft-cancel runs first, a later paid callback should restore paid after Phase 29.
- If provider still reports pending after soft-cancel, the local storefront helper now preserves `cancelled`; this still needs rollout verification.

### E. User closes browser immediately after payment

Classification: DEGRADED.

- Callback/IPN can recover.
- If neither arrives and no traffic hits recovery triggers, pending state persists.

### F. IPN arrives after local soft-cancel

Classification:

- SAFE if IPN verifies paid and Phase 29 is deployed.
- DEGRADED if IPN returns pending/invalid after soft-cancel; the local helper preserves `cancelled`, but traffic may still remain noisy without route limits.

### G. Callback fires twice

Classification: SAFE for paid idempotency.

- `mark_order_as_paid` returns current paid order and only tries reservation if needed.
- Audit trail may not record every duplicate provider event.

### H. IPN fires multiple times

Classification: SAFE for paid idempotency, DEGRADED for route load.

- No shared rate limit means repeated events still consume app/provider verification work.

### I. Callback and IPN arrive in different orders

Classification: DEGRADED.

- Paid truth should converge.
- Non-paid status after local cancellation remains an edge case.

### J. Supabase RPC intermittent failure

Classification: DEGRADED.

- Payment verification may throw.
- Pending recovery or later status refresh can retry.
- Admin stock reservation failure becomes fulfillment review if inside `mark_order_as_paid`.

### K. Network timeout during reservation

Classification: DEGRADED.

- If DB transaction status is unknown to the app, later refresh/retry is needed.
- If reservation throws inside SQL after paid state persists, review state is set.

### L. Order created but payment initiation fails

Classification: DEGRADED.

- Explicit no-tracking rejection cancels the order.
- Network or unknown failure can leave pending until event-driven recovery.

### M. No traffic after order creation

Classification: BROKEN for automatic cleanup timing.

- No cron means pending recovery does not run.
- Data remains pending until next trigger.

### N. No admin dashboard open

Classification: DEGRADED.

- Admin realtime is irrelevant.
- Admin push queue may still be kicked by payment transition/subscription events, but later retries can stall without triggers.

### O. Many realtime order updates across several admin devices

Classification: DEGRADED.

- Each device receives events or fallback polling.
- Each refresh can run unbounded queries.
- Data integrity remains intact; performance can degrade.

### P. Push dispatch fails and queue backlogs

Classification: DEGRADED.

- Durable rows preserve work.
- Retry backoff exists.
- No-cron means retries depend on future triggers/manual processing.

### Q. Repeated abuse of `/api/orders`, `/api/payments/status`, `/api/push/subscribe`

Classification: DANGEROUS for cost/performance.

- Checkout parses before limiting and uses in-memory buckets.
- Payment status has no shared limit.
- Push subscribe has in-memory buckets.

### R. Oversized checkout JSON payload

Classification: BROKEN.

- Body is parsed before a `Content-Length` guard.
- Can consume memory/CPU before validation.

### S. Invalid payload spam

Classification: DEGRADED.

- Invalid checkout payloads return before rate limiting.
- App still pays parse/validation cost.

### T. Stale service worker running old app logic

Classification: DEGRADED.

- Storefront does not cache API/order/checkout pages unsafely.
- Old JS can remain until reload.
- Version banner helps but does not force update.

## Explicit Answers

- Can money be lost? Not directly by rollback, but money can be accepted for unavailable stock. That becomes manual fulfillment/refund risk.
- Can stock become inconsistent? Yes. `finished_stock` is not consumed by completed sales.
- Can orders disappear? Less likely after Phase 27, but paid orders can be hidden from normal flow if migrations are not deployed or review/status logic fails.
- Can paid orders get stuck? Yes. Stock review, low traffic pending recovery, and push retry queues can stall.
- Can unpaid orders reach kitchen flow? DB transition blocks unpaid `in_prep/ready/completed`, but app-layer service-role actions need role checks.
- Can the system become expensive under abuse? Yes. Shared rate limiting and body guards are missing.
- Can low traffic prevent recovery? Yes. No-cron recovery and retry queues wait for triggers.

## F. Bakery Reference Comparison

| Area | Bakery | Smokehouse | Gap |
| --- | --- | --- | --- |
| Shared rate limiting | Supabase `api_rate_limits` + `consume_rate_limit` | in-memory or none | Port bakery pattern |
| Payment recovery | tracked pending recovery with bounded scans | local Phase 29 plus local cancelled/pending guard, not deployed | Deploy and sandbox-verify |
| Signed order access | cookie + signed access link | public token first | Port order access link |
| Checkout body guard | `Content-Length` before parse | parse first | Add guard |
| Callback/IPN hardening | route limits + logs | no shared limits/logs | Port |
| Push durability | durable queues | durable queues | Add manual retry/backlog visibility |
| Service worker safety | avoids dynamic order/payment caching | mostly same | Keep, verify stale update UX |
| Admin query limits | default/max order list limits | unbounded | Add caps |
| Security logging | structured security events | absent | Port helper |

## G. Rollout Plan

### Must Fix Before Live Customer Traffic

1. Fix `finished_stock` depletion/allocation model.
2. Add central admin role checks before every service-role server action/API route.
3. Verify the local pending-recovery guard where non-paid provider statuses cannot revive local cancellations.
4. Apply and verify Phase 29 only after that payment edge is checked in sandbox.
5. Add shared Supabase-backed rate limiting.
6. Add checkout `Content-Length` guard before parsing.

### Should Fix Before Marketing Push

1. Signed order-access/session hardening for payment status and order reads.
2. Admin order/dashboard query limits and pagination.
3. Realtime fallback backoff/jitter and hidden-tab pause.
4. Payment/IPN/callback security-event logging.
5. Push backlog visibility and manual retry controls.
6. Admin push subscription role binding.

### Can Fix After Launch

1. Menu metadata short TTL cache.
2. Explicit core RPC execute revokes once role-gated service paths are stable.
3. Login pre-auth throttling.
4. `.next` verification cleanup.
5. Environment checklist automation.

## H. Verification Notes

- Storefront `npx.cmd tsc --noEmit` passed after the local pending-payment patch.
- Storefront `npm.cmd run build` compiled, then hit local Windows `spawn EPERM`.
- Admin `npx.cmd tsc --noEmit` is blocked by stale `.next/types/validator.ts`.
- This audit did not verify live Supabase grants, live RLS state, live env vars, Vercel deployment status, or actual Pesapal sandbox callbacks.
