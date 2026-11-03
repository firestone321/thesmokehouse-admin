# Unified Admin POS implementation — 2026-11-02

Implemented and locally validated on feature/phase-3-offline-pos in both repositories. A prepared cashier can now use the existing /pos cart for ordinary local cash sales, including fresh navigation and refresh during a cloud outage. This is feature-branch code, not a deployed system.

## Operating behavior

Normal checkout defaults to the existing cloud API. The compact Cash POS connection control authorizes local cash mode with the existing cashier PIN and bridge session. An unsubmitted cart is reconciled to the authorized bridge catalog; prices and funded availability come from the bridge, and cash received must be entered again after switching. Card and mobile-money controls stay in their existing positions and are disabled locally. Switching never automatically converts an unknown cloud outcome into a local sale.

The cashier lock and IndexedDB active-attempt pointer cover both engines. The local request identity and immutable request input are saved before preparation, with original terminal/epoch and no bearer token or private key. The bridge remains the authoritative financial journal. Preparation/commit errors preserve the request as unknown; lookup and deliberate retry use the same identity. Committed local receipts enter the existing recorded-sales view. Initial drawer/receipt actions remain in the bridge; receipt-only history reprints call only the bridge reprint endpoint, and hardware-status checks use read-only lookup. No browser recovery replays original hardware.

Fresh /pos navigation falls back through the service worker to an internal public /pos-shell asset. It renders the same PosSaleWorkspace and DashboardShell. The cached HTML contains no authenticated data, grant, PIN, token or sale history. Only the public shell and static assets are precached; authenticated /pos HTML and API responses are never cached. Local PIN sign-in is required after refresh. The browser must previously have loaded the updated app and completed service-worker installation; first-ever use without any cached assets cannot work.

localStorage contains only a nonsecret last-cashier/loopback-URL entry hint, which never authorizes a sale. The bounded presentation snapshot stays in sessionStorage. If a new tab lacks that display snapshot, authorized products still load from the bridge with generic category/image placeholders. Signing keys remain in their existing server/terminal storage. Existing Phase 114 work is retained and is not used for replacement authorization.

## Actual files

Admin integration: app/(admin)/pos/page.tsx; components/pos/pos-sale-workspace.tsx; components/pos/recorded-sales.tsx; components/pos/offline-station.tsx; lib/pos/use-pos-sale.ts; lib/pos/sale-contract.ts; lib/pos/attempt-store.ts; new lib/pos/local-bridge.ts; new components/pos/offline-pos-entry.tsx; new app/pos-shell/page.tsx; public/sw.js; proxy.ts.

Admin validation: scripts/test-unified-pos.mjs; scripts/test-pos-production-shell.mjs; tests/pos-test-loader.mjs; tests/pos-storage-browser.test.mjs. The existing offline-display and offline-cash-input helpers are reused.

Bridge: src/offline/journal.ts now makes identical late preparation after commitment idempotent, avoiding recreation of a stranded draft; tests/offline-journal.test.ts covers this; tests/offline-fixture.ts accepts an optional current clock for integration tests. API shapes, journal schema, signing/settlement rules and allocation policy are unchanged. The validated v0.3.0 ZIP was not rebuilt or overwritten. Package the bridge source fix in a separately reviewed patch release (recommended v0.3.1); no new journal migration is required.

## Executed validation

- Actual React workspace + real bridge router, signed grant, SQLite journal and mock hardware in Chromium: **24 passed, 0 failed**. Covers online checkout, existing-cart reconciliation, funded consumption once, duplicate click, drawer-first printing, receipt-only reprint, interrupted preparation and commitment, preserved identity across refresh, offline startup/refresh, cash-only restrictions, bridge/PIN/grant/stock failures, restored connectivity, outbox delivery, and cloud ambiguity preserved across refresh.
- Actual isolated Next production build, then its local cloud server stopped while the cross-origin bridge remains available: **5 passed, 0 failed**. Confirms public static shell, cached production assets at /pos, bridge CORS authorization, real SQLite commitment and offline refresh. Configuration was synthetic; real Supabase/POS environment values were excluded.
- Full Admin POS regressions: **55 passed, 0 failed**. Chromium IndexedDB/Web Locks test now uses direct target navigation and readiness polling rather than the failing Page.enable event sequence; its financial assertions remain intact. Its additional damaged-pointer fail-closed assertion also passed in a focused rerun.
- Full bridge suite: **97 passed, 0 failed**, including the new late-prepare regression, journal compatibility, sync, hardware and synthetic release-safety cases. No actual hardware commands or Windows tasks were run.
- Admin and bridge TypeScript checks passed. Isolated Admin production build passed, with /pos-shell confirmed statically prerendered. No bridge package build was performed.
- At **1440px and 900px**, normal online product-card/cart geometry, font, colors and border radii match the HEAD workspace baseline with the offline feature disabled. Offline views have no horizontal overflow. Screenshots were visually inspected. The enabled feature adds only a compact connection control/status to the existing header. Standalone fixture screenshots omit the real logo asset; production-shell screenshots use actual production assets.

Online API success/failure and cloud synchronization acknowledgements were synthetic. The sync test uses the real outbox worker, but does not establish Supabase ingestion or database compatibility. No production connection or real payment was used. Screenshots and machine-readable results are in docs/validation/unified-pos-2026-11-02/.

Reproduce the source integration test from Admin with:

    node --import ../smokehouse-pos-bridge/node_modules/tsx/dist/loader.mjs scripts/test-unified-pos.mjs

The production-shell test requires an isolated synthetic-config build directory:

    node --import ../smokehouse-pos-bridge/node_modules/tsx/dist/loader.mjs scripts/test-pos-production-shell.mjs <isolated-build-directory>

## Remaining operational limits

A manually recreated payment using a different identity in another browser/device cannot be detected by the deferred cross-system replacement contract. The integrated interface blocks its preserved unresolved attempt; staff must retain the original key, restore its outcome while connected and ask a manager to review suspected duplicates. Neither timeout nor not_found releases that restriction. A damaged/missing active-request record fails closed; there is no new bypass or Phase 114 cancellation button.

The updated app and a registered running bridge with valid grants/allocation are prerequisites. Verify the venue browser permits the configured loopback origin, and perform the controlled physical printer/drawer check only under a later authorized deployment task. Supabase staging migrations and end-to-end financial settlement remain a separate validation track. New bridge source should be packaged/reviewed separately; this report does not authorize production enablement.

No commits, pushes, deployments, production migrations, storefront-price changes, allocation changes or Orders/Dashboard offline features were made.
