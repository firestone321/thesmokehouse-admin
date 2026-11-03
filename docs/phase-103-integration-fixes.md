# PHASE 103 INTEGRATION FIXES

Date: 2026-10-30
Branch: feature/phase-3-offline-pos in both repositories. Changes are local and not committed or pushed.

## Scope and result

The three reported full-schema integration defects are corrected by two new forward-only migrations. Existing Phase 103 and all historical migrations are unchanged. No production migration, deployment, stock change, payment or hardware command was performed. Offline enablement flags remain unchanged and disabled by default.

Admin HEAD at start: eb57f8e3cc9e19223d1f2a5b8c5b210d798e9089.
Bridge HEAD: 3c94df9ee75046e49737212396c1938bc90cadf2 (no source changes required).
Admin main: 88d60fcecf1c5101e2f58a331d10a87c6d9a8eb8.
Bridge main: 4ea3b210d3b346c2347f2e280b64867d0c2fac56.
The pre-existing next-env.d.ts status is preserved.

## Root causes and corrections

1. generate_order_number used lpad(value,3), which truncates longer text. db/phase-104-order-number-width.sql uses greatest(3,length(value)) as the padding width. Examples: 001, 998, 999, 1000, 1001, 999999, 1000000. nextval remains the sole identity allocator; uniqueness constraints and historical order numbers are untouched. No sequence reset occurs in the migration. Local fixture resets are confined to the disposable database. No exact-three-digit assumption was found in the inspected Admin app/lib/components/tests/scripts or bridge src/tests.

2. Daily reconciliation compared daily_stock.reserved_quantity only with paid-order reservations. db/phase-105-offline-allocation-reporting.sql adds physically funded offline holds as a separate expected-reservation bucket. Existing critical checks and all unrelated reconciliation sections remain intact. An injected one-unit mismatch still produces a critical alert. Finished-stock movements and quantities are not rewritten.

3. get_daily_menu_stock previously exposed per-serving paid-order reservations but omitted allocations. Phase 105 appends explicit allocation/source-unit fields, preserving all thirteen original columns, their order, types and values. PostgreSQL cannot replace a table-returning function with a different return type: the old function is renamed to get_daily_menu_stock_phase103_base, retaining its OID for SQL dependencies, and a new public wrapper exposes the appended fields. Both functions and the allocation helper remain service-only. The schema snapshot contains no other function calls to this daily-stock RPC. Current Admin consumers map named fields and remain compatible.

## Reporting formulas and units

- Expected daily reserved physical units = paid-order reserved source units + offline allocation-held source units.
- Expected daily sold units continue to come from paid finalized orders; allocation funding is never a sale or tender.
- Physical balance = stock_starting_quantity - stock_reserved_quantity - stock_sold_quantity - stock_waste_quantity = stock_remaining_quantity.
- For direct one-unit portions, the legacy balance becomes starting - reserved - sold - waste - offline_allocation_held_quantity = remaining.
- Legacy reserved/sold fields count sellable servings. Shared-source portions cannot be reconciled by mixing serving counts with source units; use the appended stock_* fields. Source pools repeat across child rows and must not be summed across those rows.
- allocation_stock_portion_type_id identifies the physical resource represented by the appended fields. Composite-resource funding remains reported on each physical resource row, not as an invented composite pool.
- Holds are selected by allocation service_date, not grant expiry or query time. Reading historical dates does not mutate closed-day snapshots. The existing legacy fallback to current finished stock when no daily row exists is unchanged; such rows are not frozen historical snapshots.

New fields: allocation_stock_portion_type_id, offline_allocation_held_quantity, stock_starting_quantity, stock_reserved_quantity, stock_sold_quantity, stock_waste_quantity, stock_remaining_quantity.

## Settlement boundary: Phase 3B remains required

Phase 103 stores initial quantity_held and has no validated settlement/release writer, remaining-cloud-hold counter, or offline order ingestion RPC. This fix does not fabricate one.

Local partial consumption and local exhaustion do not reduce the server hold. Their consumed units are still unavailable to online sales until synchronization is durably accepted. Existing bridge SQLite tests cover partial consumption, exhaustion, restart and grant renewal without replenishment. The server report conservatively includes all funded resource rows, including expired grants or a manually changed state: state=reconciled alone is not evidence that stock has been settled or returned.

Partial cloud settlement, full settlement and release cannot be tested end-to-end yet. Phase 3B must atomically record immutable settlement evidence, transfer each acknowledged quantity from the allocation bucket to the appropriate paid-order reservation/finalized bucket, and adjust the hold projection exactly once without deducting finished stock twice. Settlement and return proofs must reconcile to the original funded amount; reports and funding/epoch fencing must be updated together. Never enable a future settlement writer against the initial-hold projection left unchanged by this migration. Cross-day ingestion and closed-day adjustment policy also remain Phase 3B/3C decisions.

## Allocation policy

Funding is unchanged: ceil(35% of eligible currently available physical stock) is the minimum/default. Existing paid reservations and other allocations reduce the available pool first. Smaller allocations are rejected. Every funding call already requires an admin/manager identity through the restricted service RPC, including larger allocations. Resource rows are locked in stable ID order and funding/stock movements are atomic. Consumption or renewed grants do not automatically fund more stock.

## Files

- Created db/phase-104-order-number-width.sql.
- Created db/phase-105-offline-allocation-reporting.sql.
- Extended scripts/test-offline-migration-full-schema.mjs (previously untracked validation work).
- Modified lib/ops/types.ts and lib/ops/queries.ts for optional allocation fields and compatibility with the pre-migration RPC.
- Modified app/(admin)/inventory/page.tsx to show held physical units, identifying shared-source pools.
- Created docs/phase-103-integration-test-results.json and this report; retained docs/phase-103-migration-validation.md as the original failure record with a superseding-results link.
- Bridge source, SQLite schema, hardware paths and historical migrations are unchanged.

## Validation

- Full schema: **34/34 passed**, including all original 21 checks. Command: node scripts/test-offline-migration-full-schema.mjs <existing-schema-snapshot-directory>. Machine-readable results: docs/phase-103-integration-test-results.json.
- Admin POS/Phase 2 recovery/browser-storage tests: **32/32 passed** (npm run test:pos).
- Existing small PostgreSQL migration fixture: **passed** (npm run test:offline-sql).
- Bridge tests, including authoritative SQLite atomicity, crash/restart, duplicate submission, allocation exhaustion, authorization, corruption handling and hardware mocks: **34/34 passed** (npm test).
- Bridge TypeScript build: **passed** (npm run build).
- Admin TypeScript: **passed** (node node_modules/typescript/bin/tsc --noEmit --incremental false).
- Admin production webpack build: **passed**, from an isolated temporary source copy with shared dependencies, preserving the pre-existing next-env.d.ts. Next.js 16.2.4; all 40 static pages generated.
- Initial TypeScript/build checks caught a missing JSX closure introduced in the new inventory display. It was corrected and both checks passed on rerun. No unrelated failures remain in the executed checks.
- No physical hardware or external payment authorization was exercised.

Environment: existing schema-only snapshot, SHA-256 c2af9af25b057683fa0f07379b200631592107d749ab0cdc15b5b61bdceebd64. Source PostgreSQL 17.6; disposable loopback-only local PostgreSQL 18. Ownership, roles, grants, RLS, constraints and triggers restored; all users and transactions are synthetic. Supabase Vault is unavailable locally and was neither stubbed nor exercised. No fresh production export was needed.

The full-schema test now subtracts the explicitly asserted allocation bucket in the old daily-balance assertion; this preserves paid-reservation meaning instead of misclassifying holds. It additionally verifies exact legacy-column/value parity and the independent physical-stock equation. No original check was removed or suppressed.

## Production and rollback considerations

These files are prepared only. Review and validate on managed Supabase staging with the production PostgreSQL major version before applying. Verify order-number identity behavior with the existing live sequence position without resetting it, exact function ownership/ACLs, dashboard output and PostgREST schema cache reload after the appended RPC fields.

Apply pending migrations in numeric order (103 foundations, 104 number width, 105 allocation reporting). Existing consumers work with the added fields; the updated UI also tolerates the old RPC before migration. Do not enable production offline sales as part of this change.

Each migration is transactional; local tests prove DDL rollback. After a successful apply, use a reviewed forward corrective migration if needed. Do not restore the truncating number generator, drop funded allocations, remove reporting of outstanding holds, reset sequences, or rewrite historical orders/stock to roll back. An application rollback can hide the new UI fields while retaining database accounting and audit evidence.

MemPalace search/save tools were unavailable during this resumed session; no memory write was possible.
