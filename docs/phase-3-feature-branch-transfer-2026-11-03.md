# Phase 3 feature-branch transfer — 2026-11-03

This branch is a development handoff, NOT production-ready and NOT an installation/release instruction. Keep `feature/phase-3-offline-pos` checked out. Do not merge main, deploy, apply migrations, provision a production terminal, enable offline sales or run installation/Windows-task/printer/drawer scripts as part of fetching this work.

Transfer contains source, pending migrations where applicable, tests and documentation. Real `.env` files, credentials/signing keys, live SQLite journals and action ledgers, customer data, backups, node_modules, dist/.next, operational logs and release archives are excluded. The tracked bridge `.env.example` is a reviewed template with blank credential fields and disabled feature defaults; it is not venue configuration. Retained validation screenshots/JSON are synthetic test documentation, not customer/production data or deployable build artifacts.

Preserved limitations:

- Unified POS has local validation, but Phase 3 is not approved for production. Supabase-compatible staging, coordinated deployment and actual venue acceptance remain separate gates.
- Offline Orders is unfinished; its browser validation was interrupted. Its source is preserved, not marked ready.
- Offline Dashboard has not been implemented. No pending Dashboard-specific changes were found or invented for this transfer.
- Phase 114 fence SQL and concurrency-test work are retained. Full terminal/session identity and cross-system replacement authorization remain unfinished/deferred. Never use it to authorize a cloud-to-SQLite replacement.
- The activation patch requires a reviewed future bridge patch release (recommended v0.3.1). The source package still identifies v0.3.0 pending that review; this source state is not the previously validated v0.3.0 ZIP. Do not tag, publish or overwrite that archive.
- Keep Admin offline flags false/absent and the bridge's OFFLINE_POS_ENABLED false, OFFLINE_NEW_SALES_DISABLED true. A cloud flag alone cannot instantly revoke a disconnected terminal with a legacy cached client; local gate enforcement is essential. Do not change existing online printer settings merely to transfer source.

On the destination, inspect the repository and local modifications before fetching/switching/pulling. Do not discard or stash venue changes automatically. Prefer separate development checkouts outside the currently running bridge installation; do not pull directly into a running installation that might restart from changed source. Verify the recorded feature commit before reviewing or running tests. Secrets and original financial storage must remain under their existing protected local custody; Git is not their transfer or recovery mechanism.

Prior test counts are historical evidence in the accompanying reports; no production transactions or hardware acceptance are implied. This handoff adds no database changes and does not enable any financial feature.

Admin transfer guard: `vercel.json` disables Git-triggered deployments for this feature branch only. Other branches/main are unchanged. This follows https://vercel.com/docs/project-configuration/git-configuration . The guard must be present in the same pushed commit as the development work; do not push an intermediate unguarded commit. No Vercel project settings or external resources were changed. Manual deployments remain prohibited by this handoff.
