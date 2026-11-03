# PHASE 3C IMPLEMENTATION REPORT — SMOKEHOUSE OFFLINE POS OPERATIONS

Date: 2026-10-31 (Africa/Kampala).
Status: Development implementation saved locally for review. Production acceptance remains blocked. Final validation evidence is recorded below.

## 1. Branches and commit references

| Repository | Working branch | HEAD | Main (unchanged) |
| --- | --- | --- | --- |
| thesmokehouse-admin | feature/phase-3-offline-pos | eb57f8e3cc9e19223d1f2a5b8c5b210d798e9089 | 88d60fcecf1c5101e2f58a331d10a87c6d9a8eb8 |
| smokehouse-pos-bridge | feature/phase-3-offline-pos | 3c94df9ee75046e49737212396c1938bc90cadf2 | 4ea3b210d3b346c2347f2e280b64867d0c2fac56 |

Existing Phase 103 integration fixes and Phase 3B working-tree changes were preserved. Phase 3C remains uncommitted alongside that work; no unrelated work was stashed, discarded or committed. Admin next-env.d.ts retains its pre-existing Git modification marker with no textual patch. No main changes, pushes, tags, PRs, deployments, production migrations, production installations, real payments or physical hardware commands were performed.

MemPalace was consulted through its installed local MCP runtime after the session tool list omitted it. Retrieved feature-branch/main references matched the repositories. Memory retrieval is supplementary; drift-prone facts were verified locally.

## 2. Files created and modified

Primary Phase 3C Admin additions:

- app/(admin)/pos/offline-operations/page.tsx.
- app/api/admin/pos/offline/operations/route.ts, manage/route.ts, lookup/route.ts, recovery/route.ts.
- components/pos/close-offline-allocation.tsx, recovery-evidence-upload.tsx, terminal-handover.tsx, offline-identity-lookup.tsx.
- lib/pos/offline-operations.ts, offline-operations-actions.ts, offline-terminal-messages.ts.
- db/phase-108-offline-operations.sql through phase-112-offline-issuance-integrity.sql.
- scripts/test-offline-operations-full-schema.mjs and tests/pos-offline-operations.test.mjs.
- docs/phase-3c-implementation-report.md, phase-3c-operations-runbook.md and final machine-readable validation evidence.

Existing Admin files extended: POS page, offline-station provisioning, offline grant signer/route, offline-ingestion verification/route, full-schema test runners. Older Phase 104–107 and inventory reporting changes are retained prior work, not historical migrations rewritten by Phase 3C. Admin .env.example is ignored by this repository; required settings are documented in the versioned runbook rather than force-adding local configuration.

Primary bridge additions:

- src/offline/operations-schema.ts, operations-worker.ts, automatic-backups.ts, backup-job.ts, recovery.ts.
- src/offline-recovery.ts and src/offline-service.ts.
- scripts/install-offline-sync-task.ps1, switch-offline-owner.ps1, set-offline-storage-acl.ps1, prepare-offline-identity.mjs.
- tests/offline-operations.test.ts and docs/phase-3c-operations-runbook.md.

Existing bridge files extended: journal/security/router/runtime/backup; retained Phase 3B sync contract/schema/worker and UI/server shutdown integration. offline-maintenance awaits graceful shutdown. .env.example includes explicit disabled defaults. Existing offline-browser.test.ts now waits for reprint refresh completion before simulating session expiry; its original expiry, restart, identity and hardware assertions remain intact.

The companion validation JSON includes complete Git status inventories, which also identify preserved prior work.

## 3. Database migrations added

| Migration | Purpose |
| --- | --- |
| 108 offline operations | RLS/service-only immutable reports, decisions, conflicting evidence, approved mappings, closures, stock returns, additive close resolutions, recovery permits and versioned terminal controls |
| 109 reconciliation | Approve genuine original cash atomically; preserve original acknowledgements; explicit duplicate/late/closure outcomes; allocation return-aware reporting and immutable imported orders |
| 110 management views | Manager enrollment/funding wrappers, filtered evidence/terminal/allocation/close views, staff-safe handover and authorized UUID lookup |
| 111 supervised recovery | Fenced, backup-hash/watermark-bound recovery permits; authentic original evidence import; public-key rotation plans and conflict review audit |
| 112 issuance integrity | Durable grant issuance/cashier FK evidence, funded-catalog deletion guard, permanent journal-instance registration and controlled legacy binding |

All are additive forward migrations prepared locally, not applied to Supabase. New functions are service-only; manager functions also validate a live manager profile/ban state and require a substantive reason. Tables deny direct financial mutation to browser roles and service-role callers; mutations pass through reviewed functions. Original evidence tables reject UPDATE/DELETE.

Existing financial RPCs are retained. The ingestion wrapper acquires the terminal lock before checking closure, then delegates to the original Phase 106 function. Original duplicates retain the exact original acknowledgement. New grant snapshots honor suspension controls. No sequence reset, historical renumbering or stock rewrite is supplied.

## 4. Reconciliation interface and workflows

Implemented manager-only /pos/offline-operations, live authentication required and local-auth bypass denied. Filters cover terminal, cashier, original business date, issue, open/closed status and original UUID. Financial-record filters apply before the 200-record display limit; conflicting payload evidence is separately bounded to 100 records. Unreported local outcomes cannot be reconstructed in the cloud; signed last-known unresolved metadata is displayed per terminal.

Records expose original UUID, terminal/epoch/sequence, cashier, business date, receipt reference, cash total, canonical mapping, reason, signatures/hash and decision history. Authorization tokens/private keys/PINs are redacted.

Audited actions: review, genuine historical sale approval, duplicate investigation/confirmation, late-close resolution, explicitly reconciled incident closure, conflict-evidence review and device handover. Every decision retains reviewer, time, reason, original reference and result. Genuine approval posts missing order/items/cash tender/settlement atomically from the immutable original payload, with original price, cashier, capture time and service day. Current cashier disablement or terminal revocation requires manager review rather than evidence loss.

Confirmed duplicate explicitly links an existing paid POS order matching cashier/date/cash total; it produces no new tender or sale settlement. This is a human evidence decision, not automated proof that two independent UUIDs describe one physical event. A duplicate confirmation cannot later silently become a genuine posting. Arbitrary edits to original money or signed evidence are unavailable.

Original ingestion and acknowledgement are not rewritten after approval. Separate approved-posting records and hash-bound resolution certificates reconcile the original local outbox item. Merely flagging/reviewing a record cannot close missing financial effects.

## 5. Allocation lifecycle implementation

Minimum/default remains ceil(35% of eligible available physical source stock). Existing funding uses atomic row locks; below-minimum funding fails, larger funding requires manager approval, and consumed budgets are not replenished by grant renewal. Manager UI prepares approved funding; it never creates stock or auto-refills.

Local closure requires no pending/uncertain financial items or drafts, complete contiguous sequence, original immutable sale/grant evidence, recomputed resource consumption and matching residual budgets. It permanently stops local spending against that allocation. Closure delivery has its own immutable identity and durable cloud acknowledgement.

Cloud closure verifies every manifest item against original ingestion identity/hash/sequence/allocation/resource requirements and explicit canonical or approved duplicate outcome. Expiry, report silence or zero pending count cannot substitute for closure. Stock return requires closure plus allocation expiry and exact unused quantities. Terminal → allocation/resource → stock lock order serializes closure, ingestion, manager settlement and returns. Unique allocation/resource return records prevent double return.

For funded F, durable local consumed C, cloud settled S and already returned R:

- Cloud hold = F - S - R.
- Proven unused total = F - C.
- Remaining releasable unused = F - C - R.
- Unresolved consumed hold after proven returns = C - S.

Displays separate funded, last-reported consumed, settled, outstanding hold, verified unused, returned and unresolved physical source units. Existing daily-stock/finished-movement critical drift detection remains active. Returns subtract original-day reservations and add finished stock with an adjustment movement; cross-day return credits an existing current daily starting balance, without rewriting signed closes.

Fully settled/returned allocations can close; this implementation conservatively waits for expiry even when exhausted. Confirmed duplicate consumption remains held pending independently verified stock resolution. Lost/disconnected terminals and incomplete restored journals cannot release holds automatically.

## 6. Terminal administration

Implemented manager enrollment, original upgraded-journal binding, terminal/epoch/key views, last reported communication, suspension, revocation, handover and replacement preparation.

Fresh enrollment proves possession of a private terminal key using a fresh nonce-signed one-minute proof; only public key data enters Admin. It binds server registration to an empty journal UUID and fresh key/epoch. Initial managed policy permits one enabled bound Windows journal. Existing Phase 3A/3B journals require an explicit manager legacy-binding workflow and cannot regress below known cloud/report sequence.

A server-signed identity-only receipt binds terminal/epoch/journal UUID. Managed new cash and allocation closure require it. A fresh empty directory cannot reuse the receipt or a cached grant. It does not grant cash authority or bypass grant expiry/PIN/session rules. Existing committed outbox delivery remains available without new enrollment.

Replacement fences the original, uses a new key/epoch/journal and preserves original stock/evidence. Supervised restored journals remain evidence-only. These mechanisms do not claim protection against privileged OS copying of the complete original key/journal outside the supported recovery process.

## 7. Device-switching safeguards

POS displays last contact, last reported pending count and stale/unknown status; risky handover details expand automatically. Phones remain online-only, cannot inspect the original PC's journal, and receive no copied local financial payloads.

Staff can look up a known UUID subject to original-cashier/manager authorization. Missing cloud evidence explicitly means local status is unknown. No automatic recreation of a missing sale, duplicate matching or financial journal replication was added. Manager handover records the decision; it does not declare an offline journal empty or free its stock.

Terminal reports refresh every 30 seconds when connected; displayed status becomes stale after two minutes. This is operational metadata, never a real-time guarantee.

## 8. Backup scheduling and recovery

Implemented automatic read-only snapshot worker, consistent VACUUM INTO, integrity/FK/schema/signature/sequence verification, AES-256-GCM, fsync/readback verification, authenticated backup-index sequence watermark, retention and storage checks. Pending cash and sequence are included in recovery-point reporting.

Backup snapshots/plaintext staging stay under protected local storage; independent destination receives ciphertext. A second folder on the internal disk is rejected; destination/key overlap and localhost loopback shares are rejected. Physical independence and external key escrow require operator confirmation and acceptance testing. Protected key-file and prepared Windows DACL foundations are provided.

Failed backup configuration or storage errors are durable diagnostics and preserve last good backup/sync. An optional verified-backup age guard independently blocks new cash; it does not stop outbox synchronization.

Supervised restore verifies ciphertext hash, authentication, schema, signatures, original terminal/epoch and minimum known sequence. It requires a manager permit for a revoked/fenced epoch. Fresh target only; no automatic restore or overwrite. Restores are evidence-only, never new cash/hardware/closure authorities, and retain original hardware records. Stale backup salvage is explicit forensic evidence only, with unknown-tail status.

CLI exports original signed evidence for bounded manager import. Server re-verifies original capture-time authority and records unknown historical evidence for approval; known UUIDs remain idempotent. Financial effects require explicit manager approval. No old drawer command is replayed.

## 9. Windows service/startup decision

Preserve interactive Windows printer ownership as default. Implemented optional headless sync/operations/backup entry point with hardware forbidden, no cash HTTP surface and new cash forcibly disabled.

Prepared a disabled Windows Scheduled Task installer, explicit single-owner handover and storage/key ACL scripts. The journal process lock prevents concurrent runtime owners; read-only backup snapshots do not introduce another financial writer. Unattended task supports startup/restart/one instance after explicit installation/configuration approval. Nothing was installed, started as a task or changed on the production PC.

A native Windows service and seamless automatic interactive/headless failover are deferred. Task credentials, session logoff, backup-share access and spooler account compatibility still require machine acceptance. PowerShell scripts were syntax-parsed only. See the operations runbook for the Microsoft command references and rollout tradeoff.

## 10. Key rotation and revocation design

Public verification history supports current and prior Ed25519 grant keys (up to 64). Current signatures carry a public key thumbprint; old capture-time grants remain verifiable during delayed ingestion/recovery. Manager rotation workflow records public history and forbids removing currently trusted public keys; actual private-key deployment remains a separately reviewed operation.

Terminal private key can use a protected local file; no service-role or Admin signing private key is shipped to Windows. Existing local-origin rules, bounded sessions, PIN throttling, terminal signatures and durable hardware replay protections are preserved.

Suspend/revoke affects new server grants immediately and reaches connected local commitment through monotonic controls. Disconnected terminals cannot learn instantly. Cash grants remain bounded to at most 12 hours and the original allocation/service-day expiry; remaining funded inventory also bounds consumption. Background retries continue after cash authorization expires.

## 11. Daily-close adjustment behavior

Late accepted cash retains the historical service day and existing canonical tender. Manager review creates one additive immutable close-resolution row tied to original sale, snapshot, reviewer, reason and decision. It does not add another tender or update the signed snapshot.

UI shows original signed cash/expected register cash, verified adjustment total, adjusted expectation and each late sale's state. Original immutable Phase 3B adjustment evidence is retained. Retried decision is idempotent; another economic application for the same original late sale is rejected.

## 12. Automated test results

| Validation | Final result |
| --- | --- |
| Full-schema PostgreSQL integration (all existing 56 plus 31 additional checks) | 87 / 87 PASS |
| Admin POS/recovery/authorization/browser regressions | 40 / 40 PASS |
| Bridge/SQLite/sync/backup/physical-hardware mocks/browser regressions | 58 / 58 PASS |
| Existing isolated offline migration fixture | PASS |
| Admin TypeScript and isolated production webpack build | PASS |
| Bridge TypeScript production build | PASS |
| Prepared Windows scripts: syntax parse only | PASS |
| Both Git whitespace checks | PASS |

No remaining failure in these executed checks. Machine-readable evidence: docs/phase-3c-integration-test-results.json. Windows installation/spooler/real independent-destination acceptance is not represented as passing.

Tests use mocked physical printers/drawers and disposable local databases. Full-schema validation restores the actual public/auth schema, ownership, ACLs, RLS, constraints and triggers. Source snapshot is PostgreSQL 17.6; local engine is PostgreSQL 18. Schema SHA-256: c2af9af25b057683fa0f07379b200631592107d749ab0cdc15b5b61bdceebd64. No production rows or connections are used. Unavailable supabase_vault is recorded rather than stubbed.

Development failures corrected: PL/pgSQL variable/alias collisions in incident closure and closure budget checking; test-loader dependency boundary; a bridge TypeScript optional SQLite value; browser test focus fired before reprint refresh finished; concurrency fixture attempted a direct FOR UPDATE denied by real service ACLs, now uses the audited manager RPC. No existing assertion was removed/weakened. The genuine closure-before-lock production-code gap was corrected and tested separately.

Coverage includes manager permissions/audit/idempotency, genuine history after disablement, independent duplicate investigation, late close, no premature release, return/settlement and closure/ingestion races, suspension/revocation/replacement/epochs/journal reinitialization, retained key verification, stale reports/phone unknown UUIDs, automatic encrypted backup/retention/corruption/watermarks/restore fencing, background workers, real browser restart and existing Phase 2 cash/card/mobile-money/recovery/receipt-only behavior.

## 13. Remaining deployment blockers

This is ready for code review only, not production enablement.

- Disposable PostgreSQL 17.6/Supabase platform acceptance of reviewed migrations 103–112.
- Security/accounting review of genuine approvals, independent-duplicate judgement, stock holds and additive closes.
- Real independent backup destination, key escrow, retention/RPO and disaster recovery drill.
- Windows dedicated account, DACLs, single-owner startup/handover, graceful updates and share access.
- Separately authorized actual drawer/printer/spooler acceptance; none performed here.
- Fresh version/release packaging and coordinated Admin/bridge/database configuration; package version is not a new published release.
- Operator training for stale device handover, original UUID investigation, stranded stock and kill switch.

## 14. Deployment and rollback instructions

Use docs/phase-3c-operations-runbook.md in either repository. Apply no production step without later explicit authorization.

Planned order: reviewed backups → additive database 103–112 → Admin with flags false → compatible Node 24 bridge preserving journal → key/ACL/independent-backup acceptance → managed terminal binding → bounded catalog/allocation/cashier provisioning → explicitly authorized cash acceptance/enabling.

Rollback first disables NEW cash and grant issuance. Keep compatible sync/operations/recovery active for committed evidence. Preserve canonical orders, cash tenders, allocation settlements/returns/holds, adjustments/decisions, journals/outboxes/hardware history, sequences and historical public keys. No evidence-deleting down migration is supplied. Never open a v3 journal with a pre-v3 binary; correct forward or retain a compatible sync-only owner.

## 15. Known limitations

- Production environment/physical hardware acceptance is outstanding; no latency benchmark claim is made.
- Cloud cannot see an unsent local tail. Stale zero-pending reports and incomplete backups cannot prove no cash exists.
- Backup RPO is nonzero; loss of terminal plus unbacked transactions may leave irrecoverable evidence. No automatic financial guessing or stock release is provided.
- Arbitrary new monetary corrections, chargebacks and duplicate-consumed-stock write-offs are not invented here. Supported economic decisions are genuine original posting, canonical duplicate reference and additive late-close expectation; unresolved stock remains held for supervised accounting review.
- Manager duplicate confirmation is human review. Matching dates/cashier/totals and UUID idempotency cannot establish that two physical events are identical.
- Operational UI is bounded, without general audit pagination. Unresolved local metadata is per terminal rather than a complete searchable remote copy of SQLite.
- One managed Windows journal initially; phones online-only. Keys/files remain dependent on Windows account/physical security; no hardware attestation or TPM anti-cloning is claimed.
- Unattended/interactive ownership requires explicit reviewed handover. Native service deployment, automatic failover and cross-session printer certification are deferred.
- Cash grants remain at most 12 hours/same allocation-day; expired capture authority does not stop synchronization of legitimate older cash.
- Forward-only migrations retain internal versioned functions for compatibility. Service-only wrappers are the authorized entry points; never grant legacy internal functions to browser roles.

## Detailed implementation references

- thesmokehouse-admin: lib/pos/offline-operations.ts:7
- thesmokehouse-admin: lib/pos/offline-operations.ts:16
- thesmokehouse-admin: lib/pos/offline-operations-actions.ts:11
- thesmokehouse-admin: lib/pos/offline-operations-actions.ts:61
- thesmokehouse-admin: lib/pos/offline-grant.ts:33
- thesmokehouse-admin: lib/pos/offline-ingestion.ts:47
- thesmokehouse-admin: app/(admin)/pos/offline-operations/page.tsx:10
- thesmokehouse-admin: app/api/admin/pos/offline/operations/route.ts:6
- thesmokehouse-admin: app/api/admin/pos/offline/recovery/route.ts:7
- thesmokehouse-admin: components/pos/terminal-handover.tsx:4
- thesmokehouse-admin: db/phase-108-offline-operations.sql:62
- thesmokehouse-admin: db/phase-108-offline-operations.sql:124
- thesmokehouse-admin: db/phase-108-offline-operations.sql:160
- thesmokehouse-admin: db/phase-109-offline-reconciliation.sql:5
- thesmokehouse-admin: db/phase-109-offline-reconciliation.sql:24
- thesmokehouse-admin: db/phase-109-offline-reconciliation.sql:165
- thesmokehouse-admin: db/phase-110-offline-management-views.sql:23
- thesmokehouse-admin: db/phase-111-offline-supervised-recovery.sql:2
- thesmokehouse-admin: db/phase-112-offline-issuance-integrity.sql:41
- thesmokehouse-admin: db/phase-112-offline-issuance-integrity.sql:54
- thesmokehouse-admin: scripts/test-offline-operations-full-schema.mjs:4
- smokehouse-pos-bridge: src/offline/operations-schema.ts:1
- smokehouse-pos-bridge: src/offline/journal.ts:311
- smokehouse-pos-bridge: src/offline/journal.ts:318
- smokehouse-pos-bridge: src/offline/journal.ts:340
- smokehouse-pos-bridge: src/offline/journal.ts:350
- smokehouse-pos-bridge: src/offline/security.ts:45
- smokehouse-pos-bridge: src/offline/operations-worker.ts:6
- smokehouse-pos-bridge: src/offline/automatic-backups.ts:6
- smokehouse-pos-bridge: src/offline/backup-job.ts:35
- smokehouse-pos-bridge: src/offline/recovery.ts:6
- smokehouse-pos-bridge: src/offline-service.ts:4
- smokehouse-pos-bridge: src/offline-recovery.ts:9
- smokehouse-pos-bridge: scripts/install-offline-sync-task.ps1:2
- smokehouse-pos-bridge: scripts/switch-offline-owner.ps1:2
- smokehouse-pos-bridge: scripts/set-offline-storage-acl.ps1:2
- smokehouse-pos-bridge: tests/offline-operations.test.ts:21
