# Firestone Smokehouse Admin — dormant POS deployment-safety verification

2026-11-03 · Branch `feature/phase-3-offline-pos` · Verification only.

**Verdict: NOT SAFE TO MERGE the current feature branch wholesale.** A restricted candidate consisting of `main` plus the eight runtime files below builds successfully and passes the scoped route checks. Isolate that scope before treating it as approved for a dormant deployment. No merge, commit, deployment or production access occurred.

Admin main: `88d60fcecf1c5101e2f58a331d10a87c6d9a8eb8`. Feature HEAD: `eb57f8e3cc9e19223d1f2a5b8c5b210d798e9089`, with substantial uncommitted work. The verified implementation includes untracked files; merging the current HEAD alone would not include them. Neither main nor the feature branch was changed by this verification.

**Blocking findings and smallest corrections**

1. **VERIFIED — the Admin offline flag does not disable the public startup path.** `app/(admin)/pos/page.tsx:16–26` gates provisioning and the workspace bridge URL, but `app/pos-shell/page.tsx:4` unconditionally renders `OfflinePosEntry`. `components/pos/offline-pos-entry.tsx:9–10` reads an entry hint from localStorage and mounts the authorized local checkout without checking the server feature flag. `proxy.ts:13` deliberately bypasses cloud authentication for this public shell. `public/sw.js:23,56,59` precaches and serves it regardless of the offline flag.

   Reproduced against an actual production build made with all five Admin offline flags false: a synthetic terminal with a separately valid signed bridge grant accepted a cash sale into its real SQLite journal, consumed one funded unit exactly once and invoked mock drawer/receipt adapters. The normal authenticated `/pos` page was never required. This does **not** manufacture a grant or bypass bridge permissions, and installed v0.2.1 cannot execute offline sales. It proves that the Admin flag is not a complete disable switch when an enabled authorized offline bridge is available.

   Smallest correction for this release: exclude the POS startup shell, its proxy exception and service-worker fallback entirely. Keep the existing main page, proxy and worker. If startup code must ship now, it needs a reviewed server/build-controlled disabled state and cache behavior that cannot retain an executable authorized shell when the deployment is disabled; hiding a button or trusting localStorage is insufficient. Do not add a cloud check that inadvertently destroys the later offline-startup contract.

2. **VERIFIED — the current branch/working tree exceeds the deployment scope.** It contains unfinished Orders changes, unconditional Orders-shell precaching, offline management and ingestion routes, staged database migrations and staging tools. These are not required by the dormant shared-cart implementation. In particular, simply deleting `/orders-shell` while retaining the current service worker makes its mandatory `cache.addAll`/shell installation chain fail. The existing logout-button change also imports the unfinished Orders cache. Restore those files to main in the deployment candidate, rather than deleting their work from the feature branch.

**Production flags**

| Flag | Default and effect | Evidence |
|---|---|---|
| `POS_OFFLINE_ENABLED` | Absent/false disables cloud grant issuance and normal `/pos` offline controls; incomplete shell gate as above | `lib/pos/offline-grant.ts:5,16`; grant route:14; POS page:16,26 |
| `POS_OFFLINE_SYNC_ENABLED` | Absent/false rejects offline ingestion before reading a request or accessing its tables | `app/api/admin/pos/offline/ingest/route.ts:18` |
| `POS_OFFLINE_OPERATIONS_ENABLED` | Absent/false disables manager authorization, terminal reports/lookup and handover queries | `lib/pos/offline-operations.ts:8`; operations route:9; lookup route:7; `components/pos/terminal-handover.tsx:5` |
| `POS_OFFLINE_REPLENISHMENT_ENABLED` | Absent/false disables replenishment management/signing paths; these also require operations authorization, and replenishment requires synchronization | `lib/pos/offline-operations-actions.ts:68,78`; operations route:22,31–32 |
| `OFFLINE_ORDERS_ENABLED` | Absent/false disables snapshot issuance and normal Orders preparation, but its public shell still ships in the current worker | `lib/orders/offline-server.ts:13`; Orders page:69 |

Each enable test requires exact `"true"`; no browser-facing `NEXT_PUBLIC` enable switch was found in these entry paths. `.env.example` explicitly sets POS offline and sync false; operations/replenishment/Orders are absent and therefore false. These are independent gates: setting only `POS_OFFLINE_ENABLED=false` does not disable synchronization or operations if their own flags are true. Keep all five false/absent for the whole feature branch. Actual production settings were deliberately not inspected or changed.

`POS_HARDWARE_BRIDGE_ENABLED` is the existing **online printing** flag, not an offline feature flag. Preserve its working production value, bridge address, origin and signing configuration. Do not disable printing as a means of disabling offline sales.

Bridge-side flags are separate: `OFFLINE_POS_ENABLED` mounts the offline router (`src/server.ts:73–75`); `OFFLINE_SYNC_ENABLED`, `OFFLINE_OPERATIONS_ENABLED`, `OFFLINE_REPLENISHMENT_ENABLED`, `OFFLINE_BACKUP_ENABLED` and `OFFLINE_UNATTENDED_ENABLED` govern its separate workers/owner. This review did not change or assume those venue settings. v0.2.1 is the installed version assumed for compatibility, not v0.3.0.

**Online workflow and migration independence**

VERIFIED: `app/api/admin/pos/sales/route.ts`, its original-key lookup/hardware endpoints, `lib/pos/queries.ts`, `lib/pos/sale-server.ts`, `lib/pos/hardware-bridge.ts`, `lib/pos/hardware-client.ts`, `lib/pos/hardware-dispatch.ts`, `lib/auth/admin-role.ts`, `lib/schemas/admin.ts` and inventory mutation actions are unchanged from main.

The online workspace still calls `sale.submit` (`components/pos/pos-sale-workspace.tsx:173`), which preserves the original durable identity and uses the original cloud endpoint. Cash, card and mobile money use the existing `create_pos_sale_with_receipt` RPC and established reference validation. The online implementation does not automatically fall back to SQLite. These are the existing staff-recorded payment workflows, not a new external payment-authorization integration.

The online sale API checks same-origin request, validated payload and cashier authorization, hashes the immutable request, then calls one atomic receipt RPC. After commitment it obtains cash-only hardware grants. The hook dispatches drawer before receipt, and recovery/reprints do not post another sale or replay the drawer. IndexedDB recovery remains cashier-scoped, and Web Locks protect concurrent tabs. The damaged-active-pointer change fails closed.

The ordinary route needs existing Phase 2 objects: `get_pos_menu`, `pos_sale_requests`, `create_pos_sale`, Phase 100 `create_pos_sale_with_receipt`/`get_pos_sale_receipt`, and existing receipt-backlog/station tables. Phase 100 is a pre-existing requirement already reported applied by the user; deployment state was not rechecked remotely. Neither Phase 103–113 nor Phase 114 is needed for dormant online operation. No runtime reference to `fence_pos_sale_request` or `pos_sale_cancellation_fences` was found. The disabled handover returns before constructing a database client. API tests used a strict Phase-2-only database boundary rejecting unexpected RPC/table access.

PARTIAL: current production schema compatibility is established by unchanged Phase 2 contracts, the existing migration definitions, mocked Phase-2-only execution and successful builds. No live sale or real PostgreSQL SQL regression was executed in this verification. No migration, schema restore or database connection was attempted. This does not certify the pending offline migrations or production settings.

**Exact dormant merge scope**

The tested isolated candidate is main plus these **eight runtime files**, using their current working-tree contents:

- `components/pos/pos-sale-workspace.tsx`
- `components/pos/recorded-sales.tsx`
- `lib/pos/attempt-store.ts`
- `lib/pos/sale-contract.ts`
- `lib/pos/use-pos-sale.ts`
- `lib/pos/local-bridge.ts`
- `lib/pos/offline-cash-input.ts`
- `lib/pos/offline-display.ts`

Keep `app/(admin)/pos/page.tsx` at main for this dormant deployment: it passes no bridge URL, so the existing shared cart remains online-only. No local credentials or entry hint are created by this page. Helpers alone expose no new route and cannot mint bridge authorization. Ordinary browser ability to issue HTTP requests is not a substitute for bridge grants.

Include these validation-support changes if preparing the reviewed patch: `tests/pos-test-loader.mjs`, `tests/pos-storage-browser.test.mjs`, `tests/pos-offline-display.test.mjs`, `tests/pos-offline-cash-input.test.mjs`. Existing recovery/hardware tests already exist on main. No package dependency change is necessary.

Exclude all other Phase 3 changes: both shells and offline entry components; proxy/worker changes; all offline Admin API and management routes; offline station/handover/management components and server helpers; Orders components, cache, snapshot API, Orders-page/refactor and logout changes; inventory page and `lib/ops` allocation-reporting additions; all Phase 103–114 SQL; staging scripts/fixtures; unrelated package-script/generated-environment changes. Do not include `.claude` or generated build files. No Offline Dashboard implementation is needed.

The current allocation-reporting edits only read optional fields, but are unnecessary. All SQL is excluded, so this candidate contains no storefront-price, 65% allocation-policy, sequence, stock/accounting mutation or historical-record change. Online prices/availability continue coming from the existing cloud menu/RPC.

**v0.2.1 bridge compatibility**

VERIFIED at the protocol/code/test level: bridge `src/pos-actions-router.ts`, `src/pos-action-store.ts`, `src/auth.ts` and `src/receipt-fingerprint.ts` match the v0.2.1 tag. Admin online hardware code matches main. Routes remain `/pos/drawer/open`, `/pos/receipt/print` and `/pos/actions/status`, with unchanged signed action identities and receipt fingerprints. The tested bridge cases exercised authenticated HTTP, expired/altered authorization rejection, origin checks, persistent deduplication, receipt-only reprints, crash uncertainty, cooldown and rate limiting. Hardware adapters were mocked. Actual installed binaries, printer, Windows tasks and venue network were not contacted. No bridge update is required for this dormant Admin candidate.

**Executed validation**

| Check | Actual result |
|---|---|
| Focused Admin recovery, hardware ordering, real-browser IndexedDB/Web Locks, display and cash-input tests with production mode/offline flags false | **40 passed, 0 failed** |
| Additional disabled-production tests: default gates, page assembly, no handover DB call, three Phase-2-only tenders, 401/403 before RPC | **9 passed, 0 failed** |
| Bridge online action/ESC-POS regressions | **10 passed, 0 failed** |
| Full working-tree production HTTP gate checks | **7 passed**, plus public `/pos-shell` 200 observed |
| Actual production shell + real synthetic SQLite bridge reproduction | **5 reproduction checks passed**, confirming the disabled-feature defect; **not** a release-safety pass |
| Restricted candidate production HTTP checks | **10 passed, 0 failed**; six offline APIs absent, both shells absent, POS auth redirect intact, worker excludes shells |
| Full Admin TypeScript `--noEmit --incremental false` | Passed |
| Full working-tree isolated production build, Next 16.2.4 `build --webpack` | Passed; 48 prerender entries; both unwanted shells present |
| Restricted candidate isolated production build | Passed; 39 prerender entries; no offline routes/shells |

All builds used synthetic `https://example.invalid` Supabase configuration with real Supabase/POS environment variables removed. No authenticated HTML or API responses were cached by the tests' worker. Test bridge journals and grants were synthetic. No physical hardware or actual payment was used.

Initial harness-only failures were corrected: a TypeScript loader needed an enum-module alias, and restricted-build readiness incorrectly waited for an intentionally absent shell. Both corrected suites completed successfully; these were test harness errors, not application failures. The first build-copy attempt required a Windows junction instead of a privileged symlink; compilation was not started until that was corrected. No failing financial assertion was weakened or removed.

Evidence: `docs/validation/dormant-pos-deployment-2026-11-03/` contains build logs, HTTP results, the reproduction result, verification scripts and `dormant-scope-manifest.json` with exact runtime-file SHA-256 values. These scripts were run from the shared workspace; the route probe records the isolated temporary build directories. They are verification artifacts, not production rollout automation.

**Release decision**

Do not merge the complete feature branch. The smallest safe release is the explicitly tested eight-file dormant candidate plus its test support, with the main POS page, proxy and service worker retained. Prepare and review that isolated patch before merge; alternatively repair and retest comprehensive shell gating. After either change, rerun the focused checks on the exact proposed patch and confirm all offline flags remain false while preserving existing online printer settings. Supabase Phase 3 migration validation and bridge v0.3.x installation are separate approvals and are not prerequisites for the dormant eight-file candidate.

No application source was edited by this verification. Reports/evidence and disposable local build/test artifacts were created. Existing uncommitted Phase 3 work, Phase 114 SQL and the validated bridge release archive remain preserved. No production settings, database, venue installation or Windows tasks were changed.
