# Phase 3 Supabase Migration Staging Validation — 2026-11-02

**Recommendation: NO-GO for cross-repository compatibility testing that depends on validated staged migrations.** PostgreSQL 17.6 / Supabase-compatible isolated staging with a representative Phase 2 data baseline was not available. No production database connection was made.

## Environment and scope

Admin repository: feature/phase-3-offline-pos, HEAD eb57f8e3cc9e19223d1f2a5b8c5b210d798e9089. Existing uncommitted and untracked Phase 3 files were retained.

Local PostgreSQL installations discovered: 18 only. Docker executable is installed, but the Docker engine pipe is unavailable; no running container or compatible image was established. No existing isolated staging database or representative Phase 2 dataset was verified.

A retained safe snapshot reports source PostgreSQL 17.6 and preserves schema/roles/ownership metadata, but it is schema-only. The available local full-schema runner defaults to PostgreSQL 18, and the earlier isolated audit reported Supabase Vault unavailable. These differ from the requested production-compatible environment and cannot show preservation of representative historical production-like records. They are not treated as a successful staging environment for this request.

## Migration order and dependencies

Apply only verified pending migrations, in this order, to an isolated baseline matching the pre-migration production schema:

| Phase | Migration | Main dependencies and purpose |
|---|---|---|
|103|phase-103-offline-pos-foundations.sql|Existing Phase 2 POS, stock, profiles, roles and functions; terminal registration, funded allocations and frozen catalog foundations.|
|104|phase-104-order-number-width.sql|Existing order sequence and generator; preserve all digits at 1000 and above without renumbering history.|
|105|phase-105-offline-allocation-reporting.sql|103 allocation tables and existing daily stock/health RPCs; preserve old daily-stock function OID/fields and expose holds.|
|106|phase-106-offline-cash-ingestion.sql|103–105; offline identity, signed evidence, idempotent ingestion, stock settlement and late-close evidence.|
|107|phase-107-offline-settlement-reporting.sql|106 settlements; reconciliation and immutability guards for ingested orders, items and tenders.|
|108|phase-108-offline-operations.sql|Earlier terminal/ingestion foundations; manager decisions, controls, closure and unused stock return.|
|109|phase-109-offline-reconciliation.sql|108 and earlier ingestion/snapshot functions; renamed restricted internals, reconciliation and additive approved postings.|
|110|phase-110-offline-management-views.sql|Operations and reconciliation evidence; management views, filters and lookup.|
|111|phase-111-offline-supervised-recovery.sql|Terminal fencing and earlier operations; signed permits and recovery evidence.|
|112|phase-112-offline-issuance-integrity.sql|Prior terminal/grant/recovery infrastructure; original-journal binding, issuance integrity and key-rotation evidence.|
|113|phase-113-dynamic-pos-allocation.sql|103–112; 65% initial target, approved replenishment policy, funded receipts and activation safeguards.|

Static inspection and the existing runner show explicit sequential application. These are forward migrations; repeatability means running the chain against a freshly restored clean baseline, not blindly applying rename/create migrations twice to the same database. The existing full-schema runner performs rollback probes and applies the migrations against a fresh local cluster, with Phase 113 applied by its replenishment test module.

## Prerequisites for a valid staging run

1. Provision an explicitly identified isolated PostgreSQL 17.6 / Supabase-compatible instance with matching relevant extensions, including Vault where used, roles, memberships, owners, RLS, triggers and PostgREST expectations. Verify endpoint and isolation before any migration.
2. Restore a verified schema baseline from before the first migration under test and a sanitized representative Phase 2 dataset containing historical orders, tenders, inventory movements, shared physical-resource recipes and immutable signed-close snapshots. Preserve before/after hashes and business totals.
3. Verify which migrations are already applied in the actual target; do not assume production's current state. Confirm function signatures, execute grants and service-role permissions; do not connect to production during this task.
4. Apply 103 through 113 in order on a fresh staging baseline, retain every migration result, then restore the baseline again and repeat the entire run. Verify historical rows, sequences, close snapshots, existing Phase 2 sales and inventory are unchanged except for intentionally additive records.
5. Execute the existing full-schema SQL regression suite and preserve exact assertion counts/logs. Test ingestion replay and ambiguous acknowledgements, tender uniqueness, no double stock deduction, 65% ceiling and manager override, replenishment limits/activation, terminal binding/revocation, historical dates and additive late-close adjustments.

## Financial and inventory assessment

**Current staging execution: NOT RUN.** Exactly-once synchronization, no double stock consumption, funding/replenishment safety, authorization/revocation, historical reconciliation and Phase 2 compatibility have not been newly established on the requested environment. No new assertion count is available.

Static source indicates that original transaction identity and payload hash are checked; settlement accounts for previously funded physical stock; Phase 113 sets a default ceiling-rounded 65% target and constrains replenishment by settled consumption, stock and activation. These source observations require execution against the requested staging environment and representative baseline before acceptance.

The owner has separately confirmed that storefront payment before final stock reservation is intentional; failed reservation is flagged for review. Do not introduce temporary checkout holds as part of this migration validation.

## Prior evidence — not this staging run

A previous 2026-10-31 disposable full-schema audit reported 124/124 checks passing on PostgreSQL 18 using a schema-only snapshot with Supabase Vault unavailable. That earlier run exercised synthetic Phase 2 sales, offline ingestion, replay, stock settlement, 65% allocation, replenishment, closure, authorization and signed-close adjustments. It is useful historical evidence only: it was not rerun here, did not match PostgreSQL 17.6/Supabase fully, and did not contain representative pre-existing Phase 2 data.

## Remaining blockers

- A verified isolated PostgreSQL 17.6 or equivalent Supabase-compatible staging environment is not available.
- A sanitized representative pre-migration Phase 2 data baseline is not available.
- Migration application, clean-baseline repetition and current-run SQL regression assertions remain unexecuted.
- Matching extension behaviour, live staging ownership/RLS/ACLs and PostgREST compatibility remain unverified.

No production migrations, deployment, commits, pushes, Windows installation changes, payments or hardware operations were performed.

**NO-GO — obtain the specified isolated staging environment and representative baseline before treating migrations 103–113 as validated for cross-repository compatibility testing.**
