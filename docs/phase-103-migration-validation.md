# PHASE 103 — FULL-SCHEMA MIGRATION VALIDATION

> Historical failure record. Subsequent corrections and verification: [Phase 103 integration fixes](phase-103-integration-fixes.md).

Date: 2026-10-29
Verdict: NO-GO for production offline-stock funding/enablement until the failures below are resolved.

## Result

21 full-schema checks: **18 passed, 3 failed**.
The earlier simplified migration fixture also passes, but it does not exercise the existing reports;
its success alone is insufficient production-readiness evidence.

Phase 103 creates its objects successfully, rolls back cleanly when tested transactionally,
and leaves existing POS/stock/report function definitions unchanged.
Creating an empty foundation schema is different from operating funded allocations:
the reporting incompatibilities appear when an allocation is funded.

## Test environment and fidelity

- Source: read-only schema export from the configured Smokehouse Supabase project, stvbivbatrlutqhgfgic.
- Source PostgreSQL: 17.6. Disposable local PostgreSQL: 18.
- Exported public/auth definitions, ownership, role attributes/memberships, ACLs, RLS, constraints and triggers.
- Restored 84 public/auth tables and 34 application triggers before Phase 103.
- Public schema after migration: 60 tables and 93 functions.
- Owned-schema SHA-256: c2af9af25b057683fa0f07379b200631592107d749ab0cdc15b5b61bdceebd64.
- Phase 103 was absent from the production schema at export.
- No production rows were exported. Users, stock, orders and tenders in the tests were synthetic.
- All migration applications and synthetic sales ran only in the disposable localhost cluster.
- The cluster was stopped and removed after each run.
- Source was exported with database-enforced read-only connection settings. No production DDL, DML,
  sequence advancement, payment, printer/drawer command, deployment or bridge update occurred.

Limitations: this is not a managed Supabase staging project. PostgreSQL major versions differ.
The Supabase Vault extension is unavailable locally; it was not stubbed or exercised.
No production traffic/load, managed Auth API, actual terminal installation or physical hardware was tested.
The tested POS/migration paths did not need Vault.

## Failed checks

### 1. Existing stock reconciliation excludes allocation holds

Classification: verified Phase 103 integration gap; production funding blocker.

Reproduction in the full-schema clone:
1. Start with 20 synthetic units.
2. Record a normal paid Admin POS sale for 3 units through create_pos_sale_with_receipt.
3. Available stock is 17.
4. Fund the minimum allocation: ceil(17 * 0.35) = 6.
5. Finished stock correctly becomes 11; daily_stock.reserved_quantity correctly becomes 9.
6. get_business_truth_health_snapshot expects only the 3 paid-order units and emits a critical
   daily_stock_drift alert for the additional 6 allocation-held units.

This is not an observed stock loss. The accounting/report definition lacks the new class of hold.
Required fix: integrate funded, unsettled allocation resources into reconciliation while retaining
the distinction between allocated stock, paid-order reservation and finalized sales.
Do not suppress the critical check or overwrite stored counts to hide the difference.

Relevant source: db/phase-79-pos-ready-terminal.sql, daily_paid_totals/daily_stock_drift,
and the exported live get_business_truth_health_snapshot definition.

### 2. Daily stock display cannot explain its remaining quantity

Classification: verified Phase 103 integration gap; operational reporting blocker.

For the same scenario, get_daily_menu_stock reports:
- starting quantity: 20
- reserved quantity: 3
- sold/waste quantity: 0
- remaining quantity: 11

The missing 6 units are the funded offline allocation.
Its per-order reserved calculation does not expose that separate bucket.
Required fix: expose allocation-held quantities explicitly and ensure displayed totals reconcile
without relabeling a stock allocation as a completed sale.

Relevant source: db/phase-79-pos-ready-terminal.sql, get_daily_menu_stock.

### 3. Existing order-number generator truncates longer numbers

Classification: pre-existing defect, not introduced by Phase 103.

The copied generate_order_number definition uses lpad(v_next::text, 3, '0').
In the empty cloned database, longer sequence values produced duplicate numbers ["100", "100"].
That caused orders_order_number_key violations and initially masked stock tests.

The harness records this failure, then restarts ONLY the empty fixture's sequence at 1 so the
remaining stock tests can execute against the unchanged function.
No production sequence was read or advanced, and this does not establish that production has
already reached the failing boundary.

Required fix: a forward-only generator change that pads short values without truncating longer values.
Preserve numbering uniqueness; do not renumber or delete existing orders.

Relevant source: db/manual-full-operational-reset.sql:188 and the exported live generator definition.

## Passed checks

1. Full public/auth schema restores with constraints, RLS, ACLs and triggers.
2. Transactional DDL rollback leaves no Phase 103 tables/functions.
3. Phase 103 applies without replacing existing POS, stock or reconciliation function definitions.
4. Synthetic baseline starts with clean stock reconciliation.
5. Existing Phase 2 sale/receipt RPC operates with real triggers and idempotent duplicate delivery.
6. The 35% allocation uses availability after existing paid reservations.
7. Online Admin POS cannot consume allocation-held stock; rejection rolls back order/tender/request effects.
8. Funding creates no tender or phantom cash revenue; cash and daily-close totals remain correct.
9. Snapshot prices survive current-menu price edits; incorrect terminal keys are rejected.
10. Banned cashiers cannot obtain snapshots.
11. Existing role/ACL/RLS context denies browser-role access to new tables/RPCs; service-role access remains scoped.
12. Undersized/expired funding and replacement of an unreconciled terminal epoch are rejected without mutation.
13. Injected failure after the first physical stock update rolls back all holds and movement/allocation records.
14. Default allocation reserves 7 of 20 units under the real schema constraints.
15. Concurrent funding versus an online Admin POS sale cannot oversell the shared stock.
16. Shared-source portions reserve underlying stock units rather than inventing child stock.
17. Composite catalog snapshots preserve every resource requirement and fund each resource.
18. Funding creates no day-close snapshot or removal of its immutable-snapshot trigger.

## Reproduction

The reusable runner is:
scripts/test-offline-migration-full-schema.mjs

Run with a local schema-only snapshot directory containing:
- schema-owned.sql (public/auth pg_dump with ownership, no table data)
- metadata.json (source version, role attributes/memberships and extension metadata; no passwords)

Command:
node scripts/test-offline-migration-full-schema.mjs "<snapshot-directory>"

The runner creates its own isolated cluster and uses explicit loopback connection parameters.
It never loads .env files or connects to Supabase.
Its nonzero exit is intentional while the three required assertions fail.

Comparison command:
npm run test:offline-sql
Result: PASS for the simplified fixture.

## Required before rollout

- Resolve both allocation-aware reporting/reconciliation gaps.
- Resolve the pre-existing non-truncating order-number requirement.
- Rerun this full-schema matrix and the existing POS regressions.
- Complete Phase 3B ingestion, allocation settlement and acknowledgement safeguards before enabling
  real offline cash sales, plus the already documented operational deployment gates.
- Keep the migration and feature flags disabled in production until rollout is explicitly authorized.

Only the test runner and this report were added locally for this validation.
No runtime code, migration SQL, main branch, remote feature branch or production database was changed.
