# Phase 3 — Offline POS activation closure

2026-11-03. Implementation and isolated validation on both existing `feature/phase-3-offline-pos` branches. Prior deployment-safety evidence reviewed; existing Phase 3 and Phase 114 work preserved.

**Implemented: a build-controlled Admin shell plus an authoritative local bridge cash-admission gate.** No new financial protocol, grant format, journal schema, price, stock-allocation or settlement rule was introduced. Production activation remains unapproved. This report does not approve merging the unrelated unfinished Orders/other feature-branch work.

**Authority and the unavoidable disconnected-terminal limit**

`POS_OFFLINE_ENABLED=false` at Admin build time now produces public, data-free disabled HTML instead of mounting `OfflinePosEntry` (`app/pos-shell/page.tsx`). It defaults disabled. The flag remains the server gate for normal-page offline controls and grant issuance. The shell's public route remains reachable but cannot start checkout when built disabled; it contains no authenticated Admin HTML.

The bridge's **local** `OFFLINE_POS_ENABLED` is the final deployment authority for new cash. It is required independently of grants, browser hints and cloud reachability. A dormant rollout must keep that local gate closed as well as build the Admin disabled. Changing only an Admin cloud flag cannot instantly revoke an enabled, disconnected bridge with an old cached client and valid authorization. This task does not claim that impossible remote revocation guarantee. If an Admin-only instantaneous switch is required, that remains a separate contract decision requiring online checks or bounded authorization leases; it was not silently substituted here.

**Execution paths and enforcement**

- Authenticated `/pos` offline controls, `/pos-shell`, worker-served `/pos`, an already running/cached legacy shell, and the bridge-hosted `/offline/` UI ultimately reach the same bridge `/prepare` and `/commit` routes. Direct HTTP clients reach those same routes and cannot change local configuration.
- `src/offline/activation.ts` captures whether the bridge explicitly started enabled. It rechecks the process flag, `OFFLINE_NEW_SALES_DISABLED`, the current local `.env` when present, and protected `runtime/offline-sales.disabled` file presence. A present `.env` must explicitly contain one true activation setting. Unknown, duplicate, unreadable or removed-after-start configuration fails closed. Enabling a process originally started disabled requires a restart; editing `.env` alone cannot mount its router.
- For an already enabled process, writing local `.env` activation false or creating the protected stop file blocks the next admission check without a restart or cloud round trip. The file lives in the existing resolved protected persistent runtime directory, outside browser and application-replacement storage. Its ACL must remain restricted to approved operating/bridge accounts.
- `src/offline/router.ts` requires the gate before provisioning, login, preparation and commitment, including requests from previously authorized sessions. `/info` advertises the current `cashSalesEnabled` state. `src/offline/runtime.ts` also supplies the same gate to the existing journal admission callback, protecting new commitment below the HTTP layer. Existing grant verification, funded inventory, service-date, terminal/session, release-admission and journal-integrity checks remain in force.
- State, lookup, logout, signed management and receipt-only recovery retain their existing restrictions. The gate does not delete drafts, sales, outbox entries, allocations or hardware identities. Already committed work is preserved; disablement cannot undo an accepted sale. Duplicate committed journal recovery remains nonfinancial and never initiates hardware; disabled HTTP commit requests are rejected, with lookup available for recovery while the router remains mounted.
- Old grants/sessions are suspended for cash, not erased or extended. Existing sessions can still perform authorized read-only lookup until their normal expiry. New login is blocked while disabled. A restart with the router disabled exposes no `/offline` HTTP recovery routes; use the existing supervised recovery tools and preserve original identities. Reactivation never replenishes stock, renews grants or replays a drawer action.

**Admin/worker integration**

`public/sw.js` advances to v6. An enabled, public data-free shell is precached with its assets. A marked disabled response replaces the executable shell; unmarked legacy shells are not precached. Old cache deletion occurs on successful worker activation. This cannot force an already offline old worker to update, so bridge enforcement remains essential. Existing API/authenticated Admin HTML caching policies are unchanged.

`lib/pos/local-bridge.ts` now requires explicit `cashSalesEnabled=true` before local login/readiness. Missing or false activation blocks new local submission. Browser storage is still only an entry/display hint and recovery identity, never the financial authority or an activation setting. No per-sale cloud request was added. The ordinary online POS API, cloud retry/receipt/drawer flow and familiar workspace markup were not changed in this task. Critical errors use the existing persistent restriction/error handling; no routine modal, new navigation or UI redesign was added.

**Files changed in this task**

Admin runtime: `app/pos-shell/page.tsx`, `public/sw.js`, `lib/pos/local-bridge.ts`.

Admin validation: new `tests/pos-offline-activation.test.mjs`, new `scripts/test-pos-activation-production.mjs`; explicit synthetic activation supplied in existing `scripts/test-unified-pos.mjs`, `scripts/test-pos-production-shell.mjs`, `scripts/test-offline-orders.mjs` router adapters. No Orders runtime work was added.

Bridge runtime: new `src/offline/activation.ts`, `src/offline/router.ts`, `src/offline/runtime.ts`. The journal source/schema and grant format were not changed.

Bridge validation/operations: new `tests/offline-activation.test.ts`, `tests/offline-fixture.ts`, explicit synthetic activation in existing HTTP/browser test adapters, `.env.example` explanatory comments and `docs/offline-activation-2026-11-03.md`. Default feature values remain disabled.

**Executed results**

| Validation | Pass / fail |
|---|---|
| Focused Admin suite, including nine new shell/worker/client activation cases | **49 / 0** |
| Full bridge regressions, including eight new real-router/SQLite activation cases | **105 / 0** |
| Actual unified React workspace with real signed grants, SQLite and mock hardware | **24 / 0** |
| Actual disabled Next production build: direct shell, forged localStorage, cached offline navigation and refresh | **4 / 0** |
| Actual enabled Next production build: cloud-free startup, real local cash, running-session suspension and refresh | **7 / 0** |
| Actual retained pre-fix production artifact and v5 worker: local suspension defeats cached legacy client and prior session | **7 / 0** |
| Admin and bridge TypeScript checks | Passed |
| Admin production builds with activation disabled and enabled, synthetic configuration | Both passed |
| `git diff --check`, both repositories | Passed; existing CRLF notices only |

The 24 workspace checks include online checkout, interrupted prepare/commit recovery, duplicate clicks, grant expiry, bridge unavailable, insufficient allocation, cloud-ambiguity isolation, reconnection/sync, drawer-first handling and receipt-only reprinting. At 1440px and 900px the normal online product/cart geometry and style match the existing HEAD baseline with no horizontal overflow. The activation patch does not change workspace layout.

The real SQLite activation cases verified disablement between preparation and commitment with the original draft preserved and no funded consumption, denial for an already installed grant/session, stop-file and configuration persistence, and retained committed receipt/outbox/hardware identities. The production disabled-shell test deliberately kept its synthetic bridge enabled and authorized, demonstrating that fresh disabled HTML cannot be activated with a forged entry hint. The legacy-worker test first accepted one sale while enabled, then closed local admission and verified no additional sale, consumption or hardware action after suspension or refresh.

One initial enabled-production test timed out because the harness clicked the next item before the first sale had released its controls. The assertion was preserved; explicit control/cart readiness waits corrected the harness. The final run passed 7/7. No failing financial assertion was removed or weakened. Worker cache installation/replacement unit checks use a simulated worker cache; actual Chromium tests separately cover a running pre-fix v5 worker and newly cached disabled/enabled production startup. A live browser v5-to-v6 deployment cutover, real NTFS ACL changes, Task Scheduler, physical hardware and production Supabase were not exercised.

**Review and release boundary**

The strict readiness signal is additive, but updated offline Admin clients require the gated bridge source in a new patch release, recommended **v0.3.1**. The validated v0.3.0 archive was not rebuilt or overwritten and does not acquire these guarantees. Its SHA-256 remains `FB5833103D10C1FC7C1C8D522A1B17070970182F35CEB6459045B4056F87B7AB`. Online printing with venue v0.2.1 remains on unchanged endpoints; local readiness is only used for offline cash.

Review the two-gate authority rule and bridge patch before packaging. For dormant deployment, close the local bridge gate and verify denial of cash, then deploy an Admin build compiled disabled. An old bridge can be kept disabled using its existing false startup flag plus a verified restart; do not attribute live-gate behavior to an unpatched binary. Do not delete grants, stock holds or pending financial records to disable the feature. No migrations are required for this activation patch.

Evidence is in `docs/validation/offline-activation-2026-11-03/`: production/workspace results, build logs, screenshots, source hashes and summary. All tests used disposable synthetic journals/keys, local servers and mock hardware. No production connection, actual payment, migration, Windows-task/venue change, Docker use, commit, merge, push, publication, deployment or release-package build occurred. Existing uncommitted work and both main branches remain intact.
