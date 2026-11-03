# Phase 3D rollout notes — fixed 65% target

Development preparation only, 2026-10-31. No instruction here authorizes production execution.

Phase 3D supersedes the 35% initial-funding policy described in the historical Phase 3C report/runbook when Phase 113 is applied. It does not rewrite older signed budgets or migrations.

The main Windows POS receives ceil(eligible available × 0.65) initially. Its target stays fixed. Later replenishment restores only consumed/settled deficit and is capped by actual available stock and explicit policy. It never reapplies 65% after each sale. Shared-source units are counted once.

## Gates before any production enablement

- Review migrations 103–113 in order; 113 is additive. None was applied to production during this work.
- Stage with PostgreSQL 17.6/Supabase-compatible platform, real constraints/RLS/ACLs and current schema. Local full-schema checks use PG18 against the actual PG17.6 schema snapshot.
- Verify the actual POS computer's Node 24-or-newer runtime. Development Node is v24.20.0; that does not establish production Node.
- Review Windows account/DACL/single journal-owner startup, backup destination/key escrow, recovery drill and clock synchronization.
- Separately authorize and perform real receipt/drawer/spooler acceptance. No physical commands were used in development.
- Keep Phase 2 online cash/card/mobile-money and receipt-only reprint functioning. Phones remain online-only.
- Preserve journal, marker, keys, outbox, financial/hardware/funding evidence before any binary update.

## Disabled defaults and coordinated setup

Admin documented configuration:

    POS_OFFLINE_ENABLED=false
    POS_OFFLINE_OPERATIONS_ENABLED=false
    POS_OFFLINE_SYNC_ENABLED=false
    POS_OFFLINE_REPLENISHMENT_ENABLED=false

Bridge documented configuration:

    OFFLINE_POS_ENABLED=false
    OFFLINE_OPERATIONS_ENABLED=false
    OFFLINE_SYNC_ENABLED=false
    OFFLINE_REPLENISHMENT_ENABLED=false
    OFFLINE_NEW_SALES_DISABLED=true

These are preparation values, not changes to the installed environment. Admin .env.example is ignored locally; do not force-add local secrets. Signing/service-role secrets remain server-side. Windows holds its own protected terminal key and public verification history only.

After explicit authorization: back up → apply reviewed migrations 103–113 → deploy Admin with flags false → stop the original journal owner → install compatible bridge with Node24 and preserved journal → verify schema v4/identity/backups → enable management/sync for acceptance → fund the initial catalog → provision a bounded cashier grant → approve a resource policy → separately approve cash/replenishment enablement.

Schema v4 adds funding tables within the same SQLite authority. Older v1/v2/v3 journals upgrade forward; no second journal or sequence reset. A compatible bridge remains necessary for v4 recovery even if new funding is later disabled.

## Manager policy

At /pos/offline-operations, configure per-resource maximum target (at most the frozen starting target), trigger %, warning %, maximum top-up and automatic units limit. Suggested form defaults: request at/below50%, warn at/below25%. The policy remains disabled until explicitly approved.

Policy approval and larger/manual replenishments require a live manager, reason and immutable audit identity. A manager can bypass the automatic trigger/automatic units cap, but cannot exceed the starting target, operation cap, consumed deficit or available stock.

Lowering/disabling a policy controls future funding. It does not retroactively erase or reclaim already funded units. Use trusted closure/return for stock reclamation.

A latest signed report no older than two minutes must show zero pending financial items and enabled synchronization. Old zero-pending metadata does not prove current readiness. New automatic requests additionally require the configured healthy bridge sync worker. Unknown/pending financial outcomes are not refill entitlement.

## Four-stage funding delivery

1. SQLite saves request UUID before HTTP. Server atomically reserves actual stock and retains a stable signed receipt.
2. Bridge verifies and durably saves the funding confirmation. Budget has not increased.
3. Bridge durably retains and sends its signed receipt acknowledgement. Server records an activation permission bound to journal, receipt hash and revision.
4. Bridge atomically saves activation evidence and increases spendable budget once.

Lost replies/restarts repeat original identities. A sent request is never deleted as proof of success. Cloud-funded, unactivated units remain held and visibly separate from spendable local stock.

Automatic operation uses the existing 30-second worker lifecycle, a minimum 60-second new-request interval and five-minute no-op cooldown. These are background operations, not extra cloud requests per cashier sale. Local menus refresh read-only while idle to show activated allowances without a next-sale gate.

## Accounting and closure

Total cloud funding F = initial I + all top-ups.
Spendable local balance = I + activated top-ups - locally consumed C.
Cloud hold = F - cloud-settled S - returned R.
After trusted closure, unused = F - C; unresolved consumed hold = C - S.

Settlement transfers reserved to sold and never deducts finished stock twice. Closure must contain the complete cash sequence and every funding receipt/hash, including confirmed unactivated stock. Missing/unknown outcomes retain holds. Returns remain expiry-gated, audited and exactly once.

The initial other-channel 35% is not a permanent protected floor: subsequent explicitly authorized refill can consume available shared stock, as in the requested 40/26/14 example.

A completed/expired allocation is not automatically re-created for the same terminal/service day; that conservative guard prevents repeated initial percentages. Existing 35% allocations remain unchanged. Use the current valid allocation's approved replenishment, or the existing online workflow during a reviewed catalogue/day transition.

## Rollback preserving evidence

Disable automatic policy first, and disable new cash separately where needed. Keep compatible operations, funding-result retrieval/activation, financial sync and recovery endpoints running until in-flight evidence is reconciled. Turning off the entire replenishment protocol while results are unknown can strand holds; it does not erase them.

Never drop migration tables, reset identities, delete outbox/funding rows, free stock by expiry/zero pending alone, or roll a v4 database back into a v3 binary. Do not delete canonical cash, settlements, returns, signed closes or hardware history. Correct forward or use a compatible sync-only owner.

The Phase 3C backup, terminal fencing, historical-key retention and evidence-only restore safeguards still apply. A restored backup cannot sign a new trusted stock closure or replay old hardware. Lost/incomplete evidence remains supervised reconciliation, not automatic stock release.
