# Phase 3A — bridge-authoritative offline cash sales

Status: isolated feature implementation; disabled by default. No migration, deployment,
production enrollment, stock hold, or hardware operation has been performed by this work.

## Branch bases
- Admin: 88d60fcecf1c5101e2f58a331d10a87c6d9a8eb8
- Bridge: 4ea3b210d3b346c2347f2e280b64867d0c2fac56

## Authority and workflow
The existing /pos Phase 2 workflow is unchanged. A gated Local cash station panel
provisions the cashier and links to http://127.0.0.1:<port>/offline/.
The loopback screen is served entirely by the bridge; it can cold-start without Vercel,
Supabase, cached Next.js routes, a service worker, or internet.
For each physical sale choose one workflow. Never recreate a pending local sale online.

Browser storage holds an opaque session, cashier ID and transaction recovery pointer only.
Prices, prepared requests, completed sales, receipt snapshots, inventory consumption,
hardware claims and the outbox are authoritative in SQLite, not IndexedDB.
Preparation is not financial commitment. SQLite commit is the cash-sale completion boundary.
The bridge response does not wait for printing. Initial hardware executes drawer then receipt;
receipt still runs if drawer submission fails. Duplicate commitment never redispatches hardware.

## Online provisioning (not enabled or executed)
Admin requires POS_OFFLINE_ENABLED=true, POS_OFFLINE_GRANT_ISSUER, and a private Ed25519
POS_OFFLINE_GRANT_PRIVATE_JWK_B64. Use a dedicated offline signing key/audience.
The bridge requires OFFLINE_POS_ENABLED=true and the matching pinned public grant key.
Staff authentication bypass cannot issue grants. Current role and banned status are checked.
The server signs only the snapshot returned by get_pos_offline_snapshot; browsers cannot supply
prices, budgets, cashier identity, allocation IDs or grants. The terminal key thumbprint must match enrollment.
Offline grants last at most 12 hours and cannot permit another service date. Offline revocation
takes effect at grant expiry; immediate revocation cannot be promised during disconnection.

Phase 103 is PREPARED, NOT APPLIED. Staging must validate every function/trigger interaction first.
The manager-only service RPCs enroll a terminal, freeze a versioned catalog, and reserve
physical finished stock plus daily-stock capacity in the same PostgreSQL transaction.
Default/minimum reservation is ceil(35% of the lesser of current physical stock and daily remaining stock), after existing reservations. Larger explicit quantities are allowed; smaller ones are rejected under row locks. A null budget automatically derives all catalog resources.
No browser allocation-funding endpoint is exposed. There is at most one funded allocation per
terminal. Existing online sales see reduced physical/daily availability.
Initial catalogs exclude the four traveller products with accompaniment side effects.
Do not widen eligibility until their fulfillment/stock settlement is implemented.
An allocation never expires back into stock automatically: it might already have been consumed offline.
Local grants sharing an allocation never replenish its budget; a new allocation is blocked until
terminal handover/reconciliation exists. That restriction is intentional in 3A.

## Phase 3B contract
Protocol version 1: canonical UTF-8 JSON recursively sorts object keys; arrays retain order;
money, quantities and IDs are bounded integers. The bridge normalizes basket lines by menu ID.
Each immutable envelope includes transaction UUID, terminal ID/epoch, sequence, capture time,
Kampala service date, original cashier grant, catalog/allocation IDs, frozen items/requirements,
cash received/change, immutable local receipt and input hash. Terminal Ed25519 signs the canonical envelope.
Local receipt references are L-<terminal prefix>-<epoch prefix>-<sequence>; cloud order references
must be stored separately without rewriting original receipts.

SQLite outbox states: pending, attempting, outcome_unknown, acknowledged, needs_review.
Phase 3A creates pending entries and exposes a non-browser internal pending() interface.
There is NO network worker, cloud sale ingestion endpoint or acknowledgement mutation in 3A.
Phase 3B must authenticate the registered terminal, verify signature and historical grants,
deduplicate both UUID and terminal/epoch/sequence, persist per-sale acknowledgements, and settle
allocated stock without calling reserve_paid_order_stock for a second deduction.
Lost responses retry the SAME identity and payload. Never delete on send.
Transport failure and permanent business validation/review must remain distinct.
Synchronization must never print or open the drawer.

## Required before production enablement
1. Stage-validate Phase 103 and existing stock-reconciliation reports: their expected reservations
   must include allocation holds before the first real hold. Phase 3B settlement must account for
   daily reserved/sold quantities and actual fulfillment dates.
2. Implement cloud ingestion, acknowledgement recovery, durable worker/backoff and conflict review.
3. Define disabled-cashier historical acceptance, closed-day adjustments, handoff, grant-expiry policy,
   terminal replacement/fencing, backup RPO/retention and independent backup destination.
4. Validate installed Windows/Node version, private-network/loopback access, Windows ACLs,
   printer queue behavior, offline cold start and backup restoration on a staging terminal.
5. Resolve the pre-existing three-character cloud order-number truncation before its boundary.

## Rollback
Disable NEW offline commitments; do not delete the journal or restore an older ledger.
Keep pending-envelope readers, terminal keys and recovery tooling. Preserve existing Phase 2 RPCs.
Feature-branch publication was subsequently authorized. No merge, deployment, production feature enablement or production bridge update is part of this change.
