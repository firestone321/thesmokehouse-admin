# PHASE 3D IMPLEMENTATION REPORT — 65% DYNAMIC POS ALLOCATION

2026-10-31 · Development implementation; stop for review before production.
No active production changes occurred.

## 1. Branches and HEAD references

| Repository | Branch | HEAD | Main, unchanged |
| --- | --- | --- | --- |
| thesmokehouse-admin | feature/phase-3-offline-pos | eb57f8e3cc9e19223d1f2a5b8c5b210d798e9089 | 88d60fcecf1c5101e2f58a331d10a87c6d9a8eb8 |
| smokehouse-pos-bridge | feature/phase-3-offline-pos | 3c94df9ee75046e49737212396c1938bc90cadf2 | 4ea3b210d3b346c2347f2e280b64867d0c2fac56 |

All prior Phase 3A–3C and Phase 103 integration work remains in the working trees. No switch to main, stash, reset, unrelated commit, push, merge or PR was performed. This implementation is also uncommitted. The pre-existing Admin next-env.d.ts Git marker was preserved.

MemPalace was consulted through the existing local MCP runtime. The user's 65% starting-target/consumed-only clarification was saved as a durable decision. Retrieved older 35% decisions were treated as historical; repository state and current instructions take precedence.

## 2. Files modified

Admin created:

- db/phase-113-dynamic-pos-allocation.sql.
- lib/pos/offline-replenishment.ts.
- components/pos/replenishment-controls.tsx.
- scripts/test-offline-replenishment-full-schema.mjs.
- tests/pos-offline-replenishment.test.mjs.
- docs/phase-3d-implementation-report.md, phase-3d-rollout-notes.md and phase-3d-integration-test-results.json.

Admin extended:

- lib/pos/offline-terminal-messages.ts: signed replenishment/acknowledgement messages and optional closure funding manifest.
- app/api/admin/pos/offline/operations/route.ts: gated terminal funding delivery, activation and policy metadata.
- app/api/admin/pos/offline/ingest/route.ts: classify unactivated funding as a durable reviewable conflict, rather than an endlessly retryable transport failure.
- lib/pos/offline-operations-actions.ts and app/(admin)/pos/offline-operations/page.tsx: manager policies, explicit capped approval, funding/local-state reporting.
- scripts/test-offline-ingestion-full-schema.mjs: preserve legacy assertions and append Phase 113 tests; synthetic configurable starting-stock fixtures only.
- tests/pos-offline-operations.test.mjs: register the new signing-module boundary in its existing isolated route loader.

Bridge created:

- src/offline/replenishment-schema.ts and replenishment-ledger.ts.
- tests/offline-replenishment.test.ts.
- docs/phase-3d-rollout-notes.md.

Bridge extended:

- src/offline/journal.ts: v4 upgrade, budget evidence, low allocation/status and closure totals.
- src/offline/security.ts: verify independent server funding/activation evidence audiences against retained public key history.
- src/offline/operations-worker.ts and runtime.ts: healthy connected replenishment lifecycle.
- src/offline/sync-worker.ts: clear a stale failure once all financial work has actually reconciled.
- src/offline/backup.ts and backup-job.ts: schema v4 inspection/signature/balance validation.
- src/offline/ui.ts and tests/offline-browser.test.ts: automatic idle menu refresh after activation, preserving the no-next-sale-gate workflow.
- .env.example: OFFLINE_REPLENISHMENT_ENABLED=false.

Existing migrations 103–112 were not edited. The Phase 108–112 SHA-256 values match the saved Phase 3C evidence; tracked Phase 103 has no Git patch. The companion JSON records the complete working-tree inventories, including preserved earlier changes.

## 3. Migration added

Phase 113 was unused when inspected. The new forward migration:

- Replaces current initial-funding enforcement with ceil(eligible available × 0.65).
- Retains original signed allocation/catalog/cashier grant snapshots.
- Adds immutable initial target rows, versioned manager policies, stable replenishment receipts and signed terminal acknowledgement/activation records.
- Keeps initial resources separately identifiable while the existing resource held quantity becomes cumulative funded stock.
- Guards settlement against funding that was reserved but not activated before original capture.
- Extends closure validation with all funded receipt identities/hashes.
- Adds service-only get_pos_offline_resource_rollup(date) and extends the existing operations JSON without breaking daily menu-stock response columns.
- Keeps RLS, service-only write boundaries, live manager validation and immutable evidence triggers.

Existing financial creation RPC definitions remain unchanged after migration. All new DDL is prepared only; no production Supabase migration was applied. The full-schema runner applies 113 only after all 87 historical assertions, then validates old allocations again after 113.

## 4. Initial allocation calculation

Eligible availability uses the existing locked finished-stock/daily-stock path after paid commitments, waste and existing allocation holds. Each underlying physical source is considered once, even when multiple menu representations use it.

Default starting target = ceil(eligible availability × 0.65).

For 40 eligible source units: initial funding/target 26; shared pool 14. For 3 eligible units: initial funding 2; shared pool 1. Explicit larger initial budgets still require a live manager and are recorded by the manager funding workflow.

The initial target is fixed. Resupply, another sale, a retry or a later top-up never recalculates 65% of the remaining shared pool.

A legacy 35% allocation retains its original budget/target. It is not silently inflated to 65%; its legitimate old signed sales and old closure messages remain accepted. Fresh Phase 113 allocations use 65%.

A second initial allocation for the same terminal/service day is rejected rather than repeatedly applying the percentage after closure. Continue an open valid allocation through replenishment. Same-day re-cataloguing/re-initialization after closure is a known conservative restriction, not an automatic target reset.

## 5. Dynamic replenishment algorithm

For each resource:

- Starting target T is frozen at original funding.
- I = initial funding; C = locally consumed; S = cloud-settled consumption.
- F = I + all cloud-funded top-ups.
- R = returned quantity.
- Cloud outstanding hold H = F - S - R.
- Approved effective replenishment target = min(T, manager policy maximum).
- Eligible deficit D = max(0, approved target - H).

Only settled consumption is used to authorize new cloud funding. Unsent/quarantined/independently duplicated cash does not create refill entitlement. This is conservative when local consumption exceeds cloud settlement.

The default proposed policy form uses a 50% trigger and 25% warning. Both are configurable per physical resource. Ordinary automatic requests above the trigger fund nothing. Explicit manager approval may bypass the trigger and automatic units limit, while still respecting the fixed target, per-operation cap and actual shared stock.

Funded quantity is the minimum of deficit, approved operation limit, automatic authorization limit (unless explicitly manager-approved), and locked eligible shared stock. It may be smaller than the full deficit. Increasing physical stock later does not increase T.

A fresh latest terminal report must be no older than two minutes, show zero pending financial work and state synchronization is enabled. An older zero-pending report is insufficient. Terminal controls, journal identity, current service day, allocation expiry and closure are checked again under database locks.

Only one unacknowledged funded top-up per allocation is allowed. Worker cycles use the existing 30-second operations lifecycle; new request attempts are throttled to at least 60 seconds, with a five-minute cooldown after a no-op. No cloud funding call is added to individual cash-sale commitment.

Example: T=26, six settled units consumed, H=20. An explicitly approved refill may fund six, restoring 26 if six shared units exist. It does not fund ceil(shared stock × 0.65). With the default 50% automatic trigger, H=20 does not itself trigger an automatic refill; manager approval or an approved higher trigger can authorize that example.

The other-channel 35% is an initial split, not a permanently protected floor. Subsequent approved replenishment can use the genuinely available shared pool, as the requested example describes.

## 6. Authorization and manager controls

Manager interface displays editable, audited policy per allocation/resource:

- Enabled/disabled.
- Maximum effective allowance, never above the frozen starting target.
- Trigger percent and warning percent.
- Maximum units per operation.
- Maximum automatic units; larger amounts require explicit manager approval.

Each policy version/approval preserves reviewer, reason, time and immutable resulting funding evidence. Cashiers cannot configure limits or bypass them. Disabling a policy prevents new funding; it does not rewrite already funded evidence or manufacture a stock return.

Funding requests carry stable identity and fresh terminal proof, not browser-supplied stock quantities. The server calculates every quantity. Journal/terminal/epoch binding, origin protections, current staff grants, PIN/session controls, suspension/revocation and hardware protections remain in place.

Both server replenishment and synchronization flags are required. The bridge must have configured synchronization and a healthy drained financial outbox before creating a new request. Historical funded identities remain recoverable; their original receipt never changes.

## 7. SQLite budget changes

Schema v4 upgrades from v1/v2/v3 in the existing single authoritative SQLite journal. No IndexedDB financial journal was added.

New tables retain:

- Durable stable request and outcome.
- Signed server funding confirmation.
- Signed durable bridge acknowledgement.
- Signed server activation evidence and exactly-once local activation.
- Last received policy/status metadata.

State distinction:

| State | Cloud stock held? | Local spendable increment? |
| --- | --- | --- |
| Pending request / unknown outcome | Unknown; original identity retained | No |
| Confirmed signed funding in SQLite | Yes | No |
| Durable bridge acknowledgement sent, response unknown | Yes | No |
| Activation evidence durably committed with budget increment | Yes | Yes, once |
| No-op/declined receipt | No new hold | No |

Available local budget = I + activated top-ups - C. Cloud-confirmed but unactivated top-ups are shown separately. Once all funding is activated, this equals total funded minus local consumption.

Confirmation validates signature, audience, journal, epoch, allocation, catalog, service date, resource identities, ordered revision and the original consumed deficit. Even a signed inconsistent receipt cannot raise the local allowance above the original target.

Activation and budget increment occur in one SQLite transaction. Write failure rolls both back. Restart re-verifies immutable receipts/activation and reconstructs expected balances from original grants, activated funding and immutable sales; a mismatch fails closed.

## 8. Idempotency and retry handling

Request UUID is saved before HTTP delivery. Timeout, lost reply, restart or browser refresh cannot cause an additional request identity for the same unresolved operation.

Server receipts are immutable and returned exactly for identical identities. A funded-but-unacknowledged receipt blocks another fund operation. Database terminal/resource locks and uniqueness constraints serialize competing requests/managers.

The bridge stores the confirmation before its acknowledgement. Server activation is bound to receipt hash, revision and original journal. Repeated activation cannot credit the budget twice.

A successful send never deletes a request or financial outbox item. No-op outcomes are durable too, so their original identity cannot later be replayed as a fresh funding decision. After a cooldown a genuinely new request can recheck current eligibility.

A resolved manager exception clears stale synchronization failure once no financial work remains; it does not suppress unresolved items.

## 9. Settlement and stock accounting

Initial funding and each top-up atomically:

1. Lock terminal/allocation/resources and actual stock.
2. Reduce eligible globally available finished stock.
3. Add funded daily reservation and an adjustment movement.
4. Record cumulative held quantity and immutable receipt.

Synchronization then transfers funded reserved units to canonical sold units. It does not deduct finished stock again. Original order, tender, amount, price, business date and capture-time grant remain immutable.

A settlement guard permits initial capacity plus funding activated before original capture, minus prior settlements. Unactivated reserved capacity cannot be used to post extra cash. Such a signed invalid submission is a permanent reviewable conflict, not a transport retry.

Source-unit accounting is preserved for shared portions. Reporting aggregates allocation/resource rows rather than multiplying stock through menu representations. Normal POS transactions continue through their existing RPCs.

## 10. Allocation closure and returns

Closure includes original contiguous cash manifest plus every cloud-funded top-up identity/hash. Omitted funding, missing revisions, unresolved request outcomes or unmatched resource totals prevent a false release.

Local confirmed-but-unactivated funding remains unspendable, but is included as funded unused stock in closure evidence. Spendable budget is checked against activated funding; total unused evidence uses all confirmed funding.

Server return rules still require durable closure and expiry, reject stale/incomplete evidence and return unused units once per allocation/resource. Expiry, a reported zero pending count or a missing terminal never releases stock by itself.

For a trusted closed journal: verified unused = F - C; unresolved consumption = C - S. Cloud hold remains F - S - R. Duplicate-consumed units remain held pending independent stock reconciliation.

Old closures without a funding manifest remain compatible when no top-up exists. Old missing/stranded receipt evidence cannot be treated as permission to release stock.

## 11. Reporting changes

Manager view distinguishes:

- Original funding and fixed starting target.
- Cumulative additional funding and total funded allowance.
- Last-reported local consumption and spendable balance.
- Cloud-settled consumption and outstanding holds.
- Live eligible shared stock.
- Cloud funding awaiting terminal acknowledgement.
- Last-reported locally confirmed but unactivated funding.
- Last-reported request/low warning, report time and last successful cloud funding.
- Current policy and explicit limits.

Cloud acknowledgement is not presented as proof that the PC has already applied an activation response. Terminal figures remain labelled last-reported, with timestamp/staleness information; cloud cannot read an unsent local journal.

The resource rollup exposes initial/additional/total funding, settlement, returns, outstanding holds, verified unused and unresolved consumption. Unknown closure totals stay unknown. Existing daily-menu response columns retain their established contracts, and existing hold/drift helpers use cumulative funded resources correctly.

The local POS performs a read-only idle loopback refresh, so activated stock appears without reload or a manual next-sale button. It does not repost a sale or trigger hardware.

## 12. Test results

| Validation | Final result |
| --- | --- |
| Full-schema PostgreSQL integration, including all 87 historical checks | 124 / 124 PASS |
| Admin POS/authorization/recovery/browser tests | 42 / 42 PASS |
| Bridge/SQLite/backup/sync/browser/hardware mocks | 67 / 67 PASS |
| Existing isolated Phase 103 SQL migration fixture | PASS |
| Admin TypeScript and final isolated production webpack build | PASS |
| Bridge TypeScript production build | PASS |
| Both Git whitespace checks | PASS |
| Recorded Phase 108–112 migration SHA-256 comparisons | unchanged |

No remaining failure in executed checks. See docs/phase-3d-integration-test-results.json. Production platform/Windows/physical acceptance is outstanding.

Tests use disposable PostgreSQL and real SQLite/browser processes with mocked printer/drawer implementations. No production Supabase connection or physical commands were used.

Full-schema source snapshot: PostgreSQL 17.6, SHA-256 c2af9af25b057683fa0f07379b200631592107d749ab0cdc15b5b61bdceebd64. Local engine: PostgreSQL 18. Real roles, ownership, RLS, ACLs, functions, constraints and triggers were restored; unavailable supabase_vault was reported, not stubbed.

All 87 historical assertions are retained before 113. Post-113 checks also ingest a previously signed 35% sale, accept a legacy no-top-up closure and compare complete signed-close rows unchanged. New coverage includes 65%/ceiling/existing reservations/shared resources, insufficient stock, policy authority/limits, thresholds, stock intake without target growth, duplicate/lost replies, concurrent channel/manager funding, unactivated settlement rejection, revoked/expired/stale/disabled-sync states, multiple top-ups, returns, source rollup and critical drift.

Bridge tests cover durable pending identity, delayed activation, ordered revisions, forged/incorrect receipt rejection, consumed-only cap, activation-write rollback, restart/lost replies, outage/exhaustion, closure with unactivated funding, stale sync-error recovery, encrypted backups and automatic idle menu refresh without hardware replay. Existing Phase 2 cash/card/mobile-money/recovery and Phase 3A–3C checks remain.

Development test failures were corrected without weakening assertions: canonical object ordering in a new fixture; cancellation of known uncommitted drafts; classification of the new unactivated-funding error; and fresh sync-report fixture setup after tightening server gating. The database correctly rejected unactivated stock before the API error classification was corrected.

## 13. Known limitations

- Development validation is not production or physical acceptance.
- Only settled consumption authorizes replenishment; unresolved local evidence can delay refill and stays visible for review.
- Initial 35% legacy grants are not enlarged automatically. Same-day second initial funding/re-cataloguing after closure is conservatively blocked.
- Thresholds/operation caps can yield a partial restoration; the target is not guaranteed when shared stock is insufficient.
- New funding requires a latest fresh zero-pending, sync-enabled terminal report. Connectivity can disappear immediately afterwards; the staged acknowledgement/activation protocol prevents spending an unconfirmed result.
- Pending/new funding uses 30-second worker cycles, request cooldowns and existing deadlines, so activation is asynchronous; no numerical latency improvement is claimed.
- Clocks must be synchronized. Settlement retains capture-time ordering against activation with a one-second tolerance, consistent with strict financial evidence ordering; clock skew can require review rather than repricing or timestamp rewriting.
- Policy reductions affect future funding, not previously funded cash capacity. Reclaiming units still requires trusted closure and return.
- Restored journals remain evidence-only. An incomplete backup cannot prove an unknown tail or missing funding did not exist.
- One managed Windows journal initially; phones stay online-only. No independent browser stock authority or financial journal sharing.
- Public verification history and original journal/key custody remain required across rotations/recovery.
- The bridge package version has not been published as a new release. Production Node version, Windows startup, backup destination/recovery and physical spooler acceptance are not established by these local tests.

## 14. Production deployment prerequisites

No active production changes occurred: no Vercel deployment, Supabase migration, production stock mutation, installed bridge update, real payment, physical print/drawer command, feature enablement, push or merge.

Review this branch and all unapplied migrations 103–113 together. Repeat on a disposable PostgreSQL 17.6/Supabase-compatible environment, then obtain explicit rollout authorization. Verify the actual POS computer's Node 24 runtime; this development computer runs v24.20.0.

Coordinate a compatible Admin, v4 bridge, database, signing/public-key history, registered original journal, independent encrypted backups, clock synchronization and recovery drill. Configure policy defaults/limits explicitly and leave replenishment disabled until accepted.

Flags remain disabled by default:

    Admin: POS_OFFLINE_REPLENISHMENT_ENABLED=false
    Bridge: OFFLINE_REPLENISHMENT_ENABLED=false

Enabling later also requires existing offline, operations and synchronization configuration; cash sales retain their separate kill switch. See phase-3d-rollout-notes.md.

For rollback, disable policy/new cash first while retaining compatible delivery/activation/sync/recovery for already committed evidence. Do not delete receipts, requests, activations, journal/outbox, hardware ledger, stock holds/movements, canonical orders or tenders. Do not open a v4 journal using a pre-v4 binary. Prefer forward correction or a compatible sync-only owner; no destructive down migration is supplied.

## Detailed verified file references

- thesmokehouse-admin: db/phase-113-dynamic-pos-allocation.sql:28
- thesmokehouse-admin: db/phase-113-dynamic-pos-allocation.sql:119
- thesmokehouse-admin: db/phase-113-dynamic-pos-allocation.sql:147
- thesmokehouse-admin: db/phase-113-dynamic-pos-allocation.sql:199
- thesmokehouse-admin: db/phase-113-dynamic-pos-allocation.sql:226
- thesmokehouse-admin: db/phase-113-dynamic-pos-allocation.sql:240
- thesmokehouse-admin: db/phase-113-dynamic-pos-allocation.sql:302
- thesmokehouse-admin: lib/pos/offline-replenishment.ts:3
- thesmokehouse-admin: lib/pos/offline-operations-actions.ts:67
- thesmokehouse-admin: lib/pos/offline-operations-actions.ts:77
- thesmokehouse-admin: lib/pos/offline-terminal-messages.ts:15
- thesmokehouse-admin: app/api/admin/pos/offline/operations/route.ts:30
- thesmokehouse-admin: app/api/admin/pos/offline/ingest/route.ts:31
- thesmokehouse-admin: components/pos/replenishment-controls.tsx:2
- thesmokehouse-admin: app/(admin)/pos/offline-operations/page.tsx:50
- thesmokehouse-admin: scripts/test-offline-replenishment-full-schema.mjs:4
- thesmokehouse-admin: tests/pos-offline-replenishment.test.mjs:6
- smokehouse-pos-bridge: src/offline/replenishment-schema.ts:1
- smokehouse-pos-bridge: src/offline/replenishment-ledger.ts:14
- smokehouse-pos-bridge: src/offline/replenishment-ledger.ts:47
- smokehouse-pos-bridge: src/offline/replenishment-ledger.ts:65
- smokehouse-pos-bridge: src/offline/replenishment-ledger.ts:96
- smokehouse-pos-bridge: src/offline/journal.ts:6
- smokehouse-pos-bridge: src/offline/journal.ts:372
- smokehouse-pos-bridge: src/offline/security.ts:46
- smokehouse-pos-bridge: src/offline/operations-worker.ts:36
- smokehouse-pos-bridge: src/offline/runtime.ts:50
- smokehouse-pos-bridge: src/offline/sync-worker.ts:77
- smokehouse-pos-bridge: src/offline/backup-job.ts:31
- smokehouse-pos-bridge: src/offline/ui.ts:94
- smokehouse-pos-bridge: tests/offline-replenishment.test.ts:20
- smokehouse-pos-bridge: tests/offline-browser.test.ts:96
