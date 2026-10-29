# Phase 3A implementation results

Phase 3A is implemented on isolated feature branches and ready for code review and Phase 3B development.
Offline financial functionality remains disabled by default. This report records the implementation validation checkpoint; feature-branch publication was subsequently authorized. No merge, production deployment, terminal installation, or Supabase migration is authorized by publication.

## Branches and preserved work

| Repository | Branch | Base commit / unchanged main |
| --- | --- | --- |
| thesmokehouse-admin | feature/phase-3-offline-pos | 88d60fcecf1c5101e2f58a331d10a87c6d9a8eb8 |
| smokehouse-pos-bridge | feature/phase-3-offline-pos | 4ea3b210d3b346c2347f2e280b64867d0c2fac56 |

Both origins were fetched and main matched origin/main before branching.
Phase 2 receipt recovery and drawer-first bridge support were verified in the bases.
At the validation checkpoint, changes were uncommitted on the feature branches. The user subsequently authorized committing and publishing these feature branches only; main remains unchanged.
The pre-existing Admin next-env.d.ts modification was preserved under the user's explicit authorization.

## Features

- SQLite is the authoritative local cash journal. No completed offline sale is recorded in IndexedDB.
- BEGIN IMMEDIATE commits resource consumption, sequence, immutable sale/receipt/signature,
  outbox entry and original hardware intents atomically.
- UUID plus terminal ID/epoch/sequence provide stable identities. Same-identity retries return the original sale;
  changed content is rejected. Independent UUIDs do not detect semantic duplicates.
- One non-financial preparation per cashier prevents another tab replacing a pending request.
- Pinned Ed25519 cloud grants bind terminal key, cashier, permissions, catalog, allocation and expiry.
  A fresh terminal private-key proof precedes provisioning. Banned accounts cannot receive new grants.
- Local scrypt PIN verification, persisted attempt limits, bounded sessions and clock rollback checks.
- Versioned catalog freezes prices and stock requirements; no browser-supplied pricing or budget authority.
- Funding defaults to ceil(35% of currently available stock), and rejects lower explicit quantities.
  Larger manager-approved quantities are allowed. Availability is the lesser of physical finished stock
  and service-day remaining stock, after existing reservations, measured under locks.
  A null budget derives all stock resources required by the selected eligible catalog.
- Grants never replenish a consumed allocation. One funded allocation per terminal remains until reconciliation.
- A local loopback browser workspace cold-starts without Admin hosting or Supabase.
- Lost browser commit responses recover from SQLite using the original identity, with no duplicate commitment
  or drawer activation. Browser storage contains only identity/session/recovery pointers.
- Drawer-first asynchronous hardware work does not delay the cash commitment response.
  Receipt dispatch remains independent of drawer failure. Durable claims prevent uncertain replay.
  Reprints are receipt-only and deduplicated by their explicit request UUID.
- Consistent SQLite backups are AES-256-GCM encrypted and synchronized. A maintenance tool inspects recovery
  copies without activating or replacing a terminal. Independent backup scheduling/retention remain deployment work.
- Phase 3B envelope, outbox state and acknowledgement requirements are documented; no sync worker exists in 3A.
- Existing Phase 2 online cash/card/mobile-money sale logic and hardware endpoints remain intact.

## Persistence and hardware

Schema version 1 has meta, allocations, budgets, grants, sessions, login_limits, drafts,
sales, outbox and hardware tables. Sales, grants and allocation identity records reject mutation.
WAL, synchronous FULL and foreign keys are enabled. Startup verifies integrity/schema, terminal identity
and sale signatures. A writer lock excludes a second runtime. A missing database with an existing identity
marker fails closed. No empty-journal fallback is used.

New offline drawer/receipt intents are in the same SQLite authority as offline cash sales, using an
offline namespace separate from Phase 2 hardware identities. Claiming precedes the OS boundary.
A pending claim after restart becomes uncertain. Recovery and synchronization never automatically replay it.
Spool acknowledgement does not prove physical printing or drawer movement.

Offline mode requires Node 24 or newer, a pinned grant key, terminal key/epoch, and an explicit local-disk
OFFLINE_DATA_DIR outside OneDrive/UNC paths. All checks occur only when OFFLINE_POS_ENABLED=true.
Admin provisioning also requires POS_OFFLINE_ENABLED=true. No environment files were changed.

## Validation

| Check | Result |
| --- | --- |
| Admin npm run test:pos | 32 passed, including existing Phase 2 behavior and real Chromium storage/restart tests |
| Admin TypeScript, no emit | Passed |
| Admin production build | Passed using webpack in an isolated temporary source snapshot with existing dependencies |
| Bridge npm test | 34 passed, all physical hardware mocked |
| Bridge TypeScript/build | Passed |
| npm run test:offline-sql | Passed in a disposable local PostgreSQL 18 cluster; never connected to Supabase |
| Both git diff --check | Passed |

The SQLite suite covers rollback after injected mid-commit failure, child-process crash recovery,
same-ID duplicates, concurrent journal clients, stock exhaustion, preparation custody, stale prices/catalog,
grant/session expiry, terminal binding, PIN replay/rate limits, clock rollback, corrupted grants/sales/database,
durable drawer cooldown, uncertain hardware claims, independent receipt failures and encrypted backup recovery.

The HTTP test proves the commitment response arrives while mocked drawer work is still blocked.
The real local-browser test deliberately loses a commit response, restarts the browser, restores the original
sale, and receipt-only reprints with no additional drawer operation. It uses a disposable Chrome profile,
blocks external DNS, and disables the browser sandbox only for that synthetic test fixture.

The SQL fixture verifies migration compilation, all-or-nothing stock holds, competing allocations,
role/key/disabled-account rejection, frozen prices, restricted grants, rejection below 35%, and default
reservation of 7 units from 20 available. This is not full live-schema or production-trigger acceptance.

### Failures investigated

- The existing Phase 2 cooldown test initially failed under contention. Its test clock is now deterministic;
  printer implementation unchanged. Final regression passes.
- Browser tests initially timed out/crashed in this Windows environment. Existing CDP calls/shutdown now have
  bounds; the new synthetic fixture uses an isolated compatible launch configuration. Final browser tests pass.
- The Windows local PostgreSQL test launcher initially inherited daemon pipe handles and timed out.
  The launcher now separates pg_ctl stdio and stops its fixture before cleanup.
- The local SQL test caught a generated migration syntax error. The SQL was corrected; final runtime assertions pass.
- No outstanding automated-test failures remain in the commands above.

## Files created and modified

Admin modified:
- app/(admin)/pos/page.tsx — gated local-station panel; existing workspace preserved.
- package.json — serial POS test command and explicit local SQL fixture command.
- tests/pos-storage-browser.test.mjs — bounded CDP/cleanup for the existing browser regression.

Admin created:
- app/api/admin/pos/offline/grant/route.ts
- components/pos/offline-station.tsx
- lib/pos/offline-grant.ts
- db/phase-103-offline-pos-foundations.sql
- scripts/test-offline-migration.mjs
- tests/pos-offline-foundations.test.mjs
- docs/phase-3a-offline-pos.md
- docs/phase-3a-implementation-results.md

Bridge modified:
- src/server.ts — conditional offline route mounting/capability and journal shutdown.
- package.json — serial test execution.
- tests/pos-actions.test.ts — deterministic cooldown test clock.

Bridge created:
- src/offline/contract.ts
- src/offline/security.ts
- src/offline/schema.ts
- src/offline/journal.ts
- src/offline/hardware.ts
- src/offline/router.ts
- src/offline/runtime.ts
- src/offline/ui.ts
- src/offline/backup.ts
- src/offline-maintenance.ts
- tests/offline-fixture.ts
- tests/offline-journal.test.ts
- tests/offline-http.test.ts
- tests/offline-browser.test.ts
- OFFLINE-POS.md

## Prepared migration

Phase 103 is prepared and unapplied. Existing Phases 101/102 are drink-intake migrations and were preserved.
It adds service-only terminal enrollment, funded allocation/resource records, manager-only funding,
a frozen catalog, current staff eligibility checks and the snapshot RPC used by Admin signing.
Funding reduces finished stock and increases daily reservations atomically.
It does not replace create_pos_sale, create_pos_sale_with_receipt or the existing stock functions.

## Remaining Phase 3B / deployment gates

1. Cloud offline-ingestion RPC, terminal signature verification, UUID/sequence deduplication and per-sale acknowledgements.
2. Durable Windows synchronization worker with retries/backoff, ambiguous-outcome recovery and permanent-conflict review.
3. Allocation settlement without a second stock deduction; include allocation holds in stock reconciliation expectations
   before funding real stock. No automatic release, replenishment or handover is available in 3A.
4. Closed-day adjustments, historical disabled-cashier acceptance and actual fulfillment-date handling.
5. Terminal replacement/fencing, key rotation, independent scheduled backup/restore policy and device handoff.
6. Live-schema/trigger staging validation, Windows ACL/encryption/runtime validation and supervised physical hardware testing.
7. Resolve the existing cloud order-number width/truncation issue before that sequence boundary.

Initial offline catalogs deliberately exclude traveller foods with accompaniment side effects.
Offline cash grants stop new commitments at expiry or service-day rollover; committed records remain durable.
Immediate offline revocation and survival of total disk loss without independent backup are not promised.

## Production boundary

Both main refs remain unchanged. Storefront code is untouched.
No real cash/payment transaction or physical printer/drawer command was executed.
No Supabase migration, production bridge update, Vercel deployment, feature enablement, merge or PR occurred during implementation. Subsequent publication is limited to commits and pushes on the two feature branches.
Rollback must preserve pending journal records and keys; never restore an older ledger over an active terminal.
