# PHASE 3B IMPLEMENTATION REPORT — SMOKEHOUSE OFFLINE SYNCHRONIZATION

Date: 2026-10-30 (Africa/Kampala)

## 1. Implementation summary

Implemented on the existing feature branches, disabled by default. The Windows journal remains the single local financial authority. A browser-independent worker delivers immutable signed cash sales to a dedicated Admin endpoint; a dedicated PostgreSQL RPC atomically creates the canonical sale and transfers its funded stock hold to finalized consumption. Synchronization never dispatches hardware.

Status: implemented and tested locally; ready for review. Production acceptance remains pending. This is a local implementation, not a production installation or deployment. Phase 3C manager workflows and fleet management are intentionally excluded.

## 2. Branches and commit references

| Repository | Branch | HEAD/base of current uncommitted work | Unchanged main |
| --- | --- | --- | --- |
| thesmokehouse-admin | feature/phase-3-offline-pos | eb57f8e3cc9e19223d1f2a5b8c5b210d798e9089 | 88d60fcecf1c5101e2f58a331d10a87c6d9a8eb8 |
| smokehouse-pos-bridge | feature/phase-3-offline-pos | 3c94df9ee75046e49737212396c1938bc90cadf2 | 4ea3b210d3b346c2347f2e280b64867d0c2fac56 |

No commits, pushes, merges or resets were performed. Earlier uncommitted Phase 104–105 integration work was retained. The pre-existing next-env.d.ts state was preserved; its textual diff remains empty.

## 3. Files changed

Admin Phase 3B additions:

- app/api/admin/pos/offline/ingest/route.ts — terminal-only ingestion, bounded body, safe responses and feature gate.
- lib/pos/offline-ingestion.ts — strict envelope/grant validation, canonical hashing, request and sale signatures, original capture-time authorization.
- db/phase-106-offline-cash-ingestion.sql — financial ingestion, immutable evidence and stock settlement.
- db/phase-107-offline-settlement-reporting.sql — settled-resource reconciliation, close serialization and protection of imported financial records.
- scripts/test-offline-ingestion-full-schema.mjs — real cryptographic endpoint validation plus real database operations through local psql.
- scripts/test-offline-migration-full-schema.mjs — extended migration/settlement integration suite; all previous assertions retained.
- tests/pos-offline-sync.test.mjs — disabled-by-default, terminal authentication and bounded-input checks.
- docs/phase-3b-implementation-report.md and docs/phase-3b-integration-test-results.json — delivery and machine-readable evidence.

Earlier retained Admin changes: Phase 104–105 migrations, inventory field mapping/display, and Phase 103 validation reports. They are prerequisites, not newly rewritten historical migrations.

Bridge changes:

- src/offline/sync-schema.ts — transactional SQLite v1-to-v2 upgrade.
- src/offline/sync-contract.ts — strict per-sale acknowledgement validation.
- src/offline/sync-worker.ts — durable delivery lifecycle, deadlines, backoff and classification.
- src/offline/journal.ts — lease, delivery claims, acknowledgements, immutable delivery evidence, diagnostics and idempotent close.
- src/offline/security.ts — terminal proof with a separate synchronization audience and bound payload hash.
- src/offline/runtime.ts and src/server.ts — worker startup, exclusive ownership and shutdown.
- src/offline/router.ts and src/offline/ui.ts — local operator diagnostics and visible conflict/review status.
- src/offline/backup.ts — inspect both journal schema versions without activating/restoring them.
- tests/offline-sync.test.ts — worker, recovery, upgrade, lease and hardware-independence tests.
- .env.example and docs/phase-3b-offline-sync.md — disabled defaults and operator/deployment guidance.

Admin .env.example is already ignored by its repository. Its local example was extended, but the versioned configuration contract is also documented here. No real environment/secrets file was modified.

## 4. Database migrations

Prepared only; none applied to production:

1. Phase 103 foundations (existing).
2. Phase 104 order-number width correction (retained previous work).
3. Phase 105 allocation reporting (retained previous work).
4. **phase-106-offline-cash-ingestion.sql** (new).
5. **phase-107-offline-settlement-reporting.sql** (new).

Phase 106 adds:

- pos_offline_ingestions: global transaction UUID PK; unique terminal/epoch/sequence; unique local receipt identity; complete immutable signed envelope, capture evidence, payload hash, canonical order binding and durable acknowledgement.
- pos_offline_stock_settlements: one immutable transfer per sale/resource, linked to the original allocation and order.
- pos_offline_close_adjustments: immutable additive late-sale evidence linked to the original signed close, with needs_review status.
- SQL canonicalization/hash helpers and ingest_pos_offline_cash_sale.
- Outstanding-hold projection subtracting validated settlements.

Phase 107 updates reconciliation using frozen settlement resources for imported orders, serializes daily-close signing against ingestion, and guards imported orders/items/tenders from ordinary financial mutation or repeated finalization.

All new evidence tables use RLS. Browser roles have no ingestion execution or table-write access. Even service_role has SELECT rather than direct INSERT/UPDATE/DELETE on these evidence tables; mutations go through the security-definer ingestion RPC. Existing create_pos_sale, its receipt wrapper, ordinary reservation and cash reconciliation functions remain unchanged.

## 5. Offline ingestion architecture

1. Worker selects a signed committed local sale under an SQLite lease.
2. Terminal creates a fresh Ed25519 JWT for audience smokehouse-offline-sync-v1, bound to terminal ID, epoch and independently derived envelope hash.
3. HTTPS POST /api/admin/pos/offline/ingest sends the original envelope, its original signature and the public terminal JWK.
4. Admin validates exact schema/version, the fresh delivery proof, the original raw Ed25519 envelope signature and the original server-signed cashier grant at the capture timestamp.
5. The server calculates the envelope hash itself. The public key thumbprint must match the registered terminal/epoch. A staff cookie or phone cannot replace terminal key possession.
6. The server validates frozen lines, prices, totals, tender/change, receipt identity, receipt contents, normalized input hash and original Kampala business date.
7. The service-only RPC independently recomputes the full canonical payload hash, verifies registration/allocation/grant binding and validates historical financial/resource facts before producing effects.
8. The RPC commits order, items, tender, settlement, events, audit, order binding and acknowledgement together.
9. The endpoint returns the saved acknowledgement only after the RPC succeeds. It does not issue receipt or drawer authorizations.

The bridge receives no Supabase service-role credential. Terminal Ed25519 verification is performed at the trusted server endpoint; PostgreSQL does not pretend to verify Ed25519 through an unavailable extension. The RPC is therefore deliberately service-only, not a public cryptographic ingestion API.

Current grant verification uses the configured original grant signing key's public half. Retain that verification capability for outstanding captures; key rotation/history management must be reviewed before changing it.

## 6. Worker architecture and actual Windows startup

OFFLINE_POS_ENABLED must enable the existing journal runtime. OFFLINE_SYNC_ENABLED independently enables this worker within that runtime. Both default to disabled. Admin ingestion additionally requires POS_OFFLINE_SYNC_ENABLED=true; it is independent of grant issuance/new-sale UI so previously committed records can be received without issuing new grants.

The worker starts when startOffline starts, polls actual delivery rather than trusting browser online status, and runs without browser sessions, cashier login or a currently unexpired grant. Capture-time grant validity is checked at the server, not replaced with delivery-time validity.

The existing runtime writer.lock prevents a second live runtime owner. A durable SQLite lease additionally excludes competing delivery workers/clients. Requests are bounded to a 10-second default deadline (15-second maximum); the lease includes additional time. Outbox state, attempts, scheduling, acknowledgements and append-only delivery events persist across process restart.

Backoff doubles from a two-second base with 50–100% jitter, capped at fifteen minutes. Delay is measured after failure completes. A batch processes at most 25 eligible records before yielding. Conflicted records are excluded from automatic selection; unrelated valid records continue. Response bodies are bounded, and HTTP redirects are rejected.

Shutdown cancels an active request, persists uncertainty, stops scheduling and releases ownership before closing SQLite. If power disappears, stale sending records become outcome_unknown after a new owner acquires the expired lease. Exact duplicate cloud effects remain prevented even if a request was in flight when ownership was lost.

**Windows availability limitation:** scripts/install-startup.ps1 uses an AtLogOn trigger and an Interactive principal. The worker survives browser closure; this does not provide synchronization while nobody is logged into Windows. Unattended operation requires a separately reviewed Windows service or non-interactive scheduled task, a dedicated account, journal/key ACLs, reliable environment/working directory, restart policy and confirmation of the correct Windows printer/security context. None was installed or changed here.

## 7. SQLite states and persistence

The authoritative SQLite database remains journal.sqlite with WAL, synchronous=FULL and transactional writes. Schema v2 replaces only delivery metadata and retains grants, budgets, immutable sales and hardware identities. Upgrade is atomic. The backup inspector supports v1 and v2; restoring/activating a replacement terminal remains supervised.

| State | Meaning and next action |
| --- | --- |
| pending | Local cash committed; eligible for delivery. |
| sending | Claimed by the current worker; original identity retained. |
| outcome_unknown | Network/response/acknowledgement-write outcome ambiguous; retry same envelope after backoff. |
| retry_scheduled | Temporary server/rate-limit/authentication-renewal failure; durable next-attempt time. |
| acknowledged | Canonical cloud order/settlement acknowledgement validated, locally signed and saved atomically with this state. |
| conflict | Permanent validation/identity conflict; retained and visible; no automatic content changes or replacement identity. |
| needs_review | Terminal/cashier authorization problem or accepted late sale requiring signed-close review; retained and visible. |

Acknowledgement data, local integrity signature, state, timestamp and event are committed together. SQLite CHECK constraints prevent an acknowledged state without acknowledgement evidence. Immutable acknowledgement/outbox/event protections prevent silent replacement or deletion.

A signed acknowledgement is verified on journal reopen. If persistence fails after a cloud commit, the sale remains sending/unknown and is delivered again with its original identity. No sale or delivery record is deleted after synchronization.

## 8. Financial idempotency

- Global transaction UUID is unique.
- Terminal ID + registration epoch + sequence is unique.
- Original local receipt identity is independently unique.
- Same identity requires the same independently verified hash, exact immutable envelope and original signature before returning the prior acknowledgement.
- PostgreSQL advisory/row locks and uniqueness constraints serialize concurrent deliveries.
- One tender per canonical order remains enforced by the existing contract.
- The acknowledgement includes version/identity, transaction UUID, terminal/epoch/sequence, canonical order ID/number, accepted hash, server transaction timestamp and exact settled resources.
- committedAt is the timestamp stored atomically with ingestion; it is not separate WAL commit-clock instrumentation.
- Sequences may have gaps after rolled-back transactions; no sequence is reset and historical orders are never renumbered.
- Out-of-order delivery is allowed: uniqueness is enforced without letting one rejected sequence block unrelated valid records. A sequence gap is evidence for later review, not automatic proof of loss or duplication.
- Different UUIDs are not assumed to prove different physical sales. Capture timestamps, cashier, receipt, device, allocation and complete immutable contents are retained for future duplicate review.

## 9. Allocation settlement formulas

The 35% business rule is unchanged: minimum/default funding = ceil(0.35 × eligible available physical stock), after existing holds. Smaller funding is rejected; funding, including larger amounts, requires the restricted admin/manager-authorized RPC. No replenishment occurs during sync or grant renewal.

For each allocation resource:

outstanding held = original quantity_held − sum(immutable acknowledged settlement quantities).

Ingestion checks the remaining allocation under locks before transferring quantity q:

- daily reserved := daily reserved − q
- daily sold := daily sold + q
- finished available := unchanged
- immutable settlement resource quantity := q

Example: fund seven of twenty → finished availability thirteen. Synchronize four → sold four, held three, availability still thirteen. Synchronize the remaining three → sold seven, held zero, availability still thirteen. Replays change nothing.

Funding already records the nonzero finished-stock movement. Settlement records an ownership/category transfer in its own immutable ledger. It does not create a fake zero-quantity finished movement (the existing movement constraint forbids one) and does not deduct stock again.

Daily expected reserved = ordinary paid-order reserved resources + outstanding offline holds.
Daily expected sold = ordinary paid-order finalized resources + imported offline settlements.

Imported order resource accounting uses frozen settlement rows rather than today's mutable recipe mappings. Ordinary online behavior remains unchanged. The Phase 105 daily RPC automatically receives remaining holds through its existing helper and retains every legacy field. Legacy per-serving counts and appended physical-source fields must not be mixed or summed across repeated shared-source rows.

Unexplained mismatches still raise critical stock-drift alerts. Expiry alone releases nothing. The allocation is not automatically renewed or handed over to another device when consumed.

## 10. Historical accounting

Canonical imported cash sales are terminal Ready/finalized POS orders representing the locally completed cash sale. They do not recreate a current kitchen task. Original item names/prices, total, cash received/change, cashier, local receipt identity, capture timestamp and Kampala service date are preserved. Cloud order number and ingestion timestamp are additional identities/evidence.

Current catalog repricing/deactivation does not reprice or reject an otherwise valid frozen sale. Ordinary finalized-order mutation and re-finalization are blocked for imported financial records; manager corrections must be additive.

Cash reconciliation counts the tender on the original service date. A sale captured yesterday is not assigned today's business date because delivery occurred today.

If that original day already has a signed close, ingestion preserves the snapshot byte-for-byte, creates an additive pos_offline_close_adjustments row and returns needs_review with the canonical order/settlement. It is not declared fully reconciled. Close signing and ingestion use the same service-date advisory lock so concurrent acceptance is either included before close or explicitly adjusted after close. The existing close RPC still recomputes its cash figures server-side.

## 11. Conflicts and recovery

- Expired short-lived delivery proof → 401; generate a fresh proof and retry the original sale.
- Network failure, timeout, malformed/lost acknowledgement or failed local acknowledgement write → outcome_unknown; no assumption of cloud rollback.
- Temporary server error/rate limit → retry_scheduled.
- Identity reuse or invalid historical payload → conflict, visible locally.
- Invalid terminal authorization/cryptographic evidence → needs_review locally.
- Known registered but currently revoked/replaced terminal, or cashier now disabled/unauthorized → immutable server-side review evidence, no new order/tender/stock settlement.
- Closed-day late sale → canonical order plus immutable additive adjustment, local needs_review.

Accepted duplicates return the original canonical acknowledgement even if the terminal's current authorization later changed, after endpoint signature/binding verification. Quarantined evidence also remains stable on replay; simply reenabling an account does not silently turn it into a new financial transaction.

There is deliberately no automatic conflict deletion, stock release, repricing, receipt replay or manufactured replacement sale. Manager resolution and stock return/handover are Phase 3C.

## 12. Security and hardware implications

Phones remain online-only. The bridge still binds to 127.0.0.1; no listener/proxy exposure was added. Delivery uses the configured HTTPS Admin origin with no redirects, a separate request-proof audience and the exact sale hash. Replaying a request proof can only resend the same idempotent transaction.

A browser-generated record cannot obtain drawer activation through this endpoint. The worker imports no printer/hardware class, cloud acknowledgements do not create local hardware intents, and the server never calls the Phase 2 hardware authorization path. Existing explicit receipt-only reprinting remains independent.

No implementation can instantly notify a disconnected terminal of revocation. Previously issued offline grants remain bounded by their capture-time lease and funded stock. Current revocation is checked on synchronization and such evidence is quarantined. Do not claim immediate remote revocation during an internet outage.

The SQLite journal itself is not encrypted by this change; encrypted backups and local integrity signatures remain. A Windows administrator who can read/replace terminal private keys is outside the key-possession trust boundary. Production needs restrictive local ACLs, disk protection, key custody and tested backups. Diagnostics expose aggregate UGX/counts, bounded issue identities/codes and resource remaining quantities; they do not expose private keys, PINs, grant/access tokens, itemized payment data or unnecessary personal information.

## 13. Tests and verified limits

Final results: all executed checks passed; no unresolved regression in the executed suites.

| Check | Result | Execution |
| --- | --- | --- |
| Full-schema PostgreSQL + actual ingestion validation | **56/56 PASS** | node scripts/test-offline-migration-full-schema.mjs <existing-schema-snapshot-directory> |
| Admin POS/Phase 2/browser recovery + ingestion gate tests | **35/35 PASS** | npm run test:pos |
| Bridge/SQLite/worker/browser/hardware-mock tests | **48/48 PASS** | npm test |
| Phase 3A small SQL fixture | PASS | npm run test:offline-sql |
| Admin TypeScript | PASS | node node_modules/typescript/bin/tsc --noEmit --incremental false |
| Admin production build | PASS | next build --webpack in isolated source copy, 41 pages |
| Bridge production build/TypeScript | PASS | npm run build |
| Migration consistency | PASS | transactional rollback/application of 103–107, unchanged online financial definitions, legacy value/ACL parity, uniqueness and critical-drift assertions |
| Diff hygiene | PASS | git diff --check in both repositories |

Machine-readable evidence: [phase-3b-integration-test-results.json](phase-3b-integration-test-results.json).

The full-schema harness restores the existing schema-only snapshot: PostgreSQL 17.6 source, PostgreSQL 18 disposable localhost test server, owned-schema SHA-256 c2af9af25b057683fa0f07379b200631592107d749ab0cdc15b5b61bdceebd64. It restores actual constraints, triggers, ownership, roles, ACLs and RLS, and applies Phases 103–107. No production rows or connections are used.

Endpoint tests run actual Request handling, actual Ed25519/JWT/canonical validation and the real ingestion RPC against that restored database. NextResponse and PostgREST transport are adapted to native Response/local psql; financial tables, triggers and settlement operations are not mocked. Bridge worker transport tests use isolated responses; the runtime-start test mocks the cloud and printer, never real hardware.

Coverage includes the original 34 integration checks plus single and queued sales, duplicate/lost acknowledgement, modified identity/sequence conflict, invalid signature/epoch/capture grant, current staff/terminal revocation, historical prices, incorrect cash, partial/full/overconsumed allocation, concurrent ingestion, no second physical deduction, critical drift, cross-day/closed-day treatment, failed acknowledgement writes, SQLite crash/restart/upgrade, prolonged outage, retry scheduling, lease exclusion, retained conflicts, browser-independent startup/clean stop and no hardware replay.

Not performed: managed Supabase staging, deployed HTTPS/Vercel/PostgREST integration, production traffic/load, actual Windows service/logoff behavior, actual printer/drawer output or real payments. Supabase Vault is unavailable locally and was neither stubbed nor used by these paths. PostgreSQL major versions differ. These limits remain production acceptance work, not claimed passing tests.

## 14. Phase 3C boundaries

Deferred deliberately:

- Manager UI and audited decisions for quarantined cash evidence, suspected duplicate physical sales and late-close adjustments.
- Allocation return, end-of-day settlement/closure and new-allocation handover.
- Device-switching approvals, terminal replacement/fencing, backup activation and lost-terminal recovery.
- Fleet enrollment/revocation management and grant-key rotation/history policy.
- Unattended Windows service deployment if required by operations.

No accepted/rejected local cash evidence may be discarded while those workflows are pending. A canonical needs_review sale must not be re-entered on a phone as a replacement.

## 15. Production prerequisites and rollback

This implementation stops for review before Phase 3C. No deployment, production migration, production bridge installation, offline enablement, payment or physical hardware command was performed.

Before any production rollout: review the migrations and staged accounting outputs; validate against managed Supabase with the production PostgreSQL major/version/ACLs; apply pending migrations in order; refresh PostgREST schema metadata; configure and verify original grant issuer/signing verification, terminal key/epoch and funded allocation; test actual deployed HTTPS transport and bridge restart; test encrypted backup/recovery and Windows ACLs; decide the logged-in versus unattended availability requirement.

Keep all flags false until separately authorized:
- Admin POS_OFFLINE_ENABLED=false and POS_OFFLINE_SYNC_ENABLED=false.
- Bridge OFFLINE_POS_ENABLED=false and OFFLINE_SYNC_ENABLED=false.

The Admin ingestion flag can be disabled to pause receiving; the bridge worker flag can pause delivery while preserving its journal. Disabling the whole offline runtime stops both local offline selling and synchronization. Do not delete its journal to disable features.

SQLite v2 is a forward schema upgrade. Take a verified encrypted backup before a reviewed installation; do not launch an old v1-only binary against v2 or overwrite active financial files. Database rollback after success must be a reviewed forward correction retaining orders, tenders, settled holds, acknowledgements and closed-day evidence. Never restore full initial holds over already settled sales, reset sequences or undo evidence to make reports balance.

## Verified implementation references

- Admin app/api/admin/pos/offline/ingest/route.ts:16 — endpoint and service-role boundary.
- Admin lib/pos/offline-ingestion.ts:36 — signature, grant and immutable capture validation.
- Admin db/phase-106-offline-cash-ingestion.sql:14 — durable identities/evidence; :74 — atomic ingestion RPC.
- Admin db/phase-107-offline-settlement-reporting.sql:124 — frozen offline resource totals; :284 — serialized close; :357 — financial immutability guard.
- Bridge src/offline/sync-schema.ts:1 — transactional schema upgrade.
- Bridge src/offline/journal.ts:255 — lease/claim; :273 — acknowledgement and response persistence; :290 — safe diagnostics.
- Bridge src/offline/sync-worker.ts:8 — independent worker and retry lifecycle.
- Bridge src/offline/runtime.ts:42 — optional worker startup; src/server.ts:172 — shutdown integration.
- Bridge src/offline/router.ts:33 — local diagnostics.
- Bridge scripts/install-startup.ps1:18 — actual AtLogOn/Interactive startup limitation.

MemPalace tools were unavailable in this session; no memory write was possible.
