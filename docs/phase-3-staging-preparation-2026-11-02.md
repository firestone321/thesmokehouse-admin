# Phase 3 staging preparation — 2026-11-02

Recommendation: use an independently verified isolated Supabase staging project for final compatibility testing. No project was created, no database contacted, no fixtures loaded, and no migration applied. A separate native PostgreSQL 17.6 instance is useful for early SQL checks, but is not equivalent to Supabase managed services or Vault.

## Staging choices and isolation

- Supabase: a separate project has its own endpoint, credentials, database, Auth and settings. A persistent branch is another isolated database with separate credentials, but its schema is built from migration history, it is data-less by default, branch configuration or webhooks can have external effects, and branches can incur charges. Avoid copying production data or enabling Include Data. Verify the exact baseline and avoid automatic application/merging of Phase 3 migrations. Creating any billable or credential-dependent resource needs the owner's authorization.
- Before loading anything verify project reference, host, database, roles and privileges against an independently maintained staging allowlist. Use a dedicated secret set and disabled/sandbox payment, SMTP, webhooks, Edge Functions, cron and other outbound integrations; no production credentials, keys or data. Confirm the environment cannot write to production or trigger real external operations. Treat any client-side marker as an additional guard, not proof of isolation.
- Native PostgreSQL: if exact 17.6 binaries can be obtained from a trusted source, install separately from PostgreSQL 18 with distinct installation and data directories, service name, credentials and loopback-only port (for example 55432). Verify binary and server versions, process ownership and environment connection settings. Do not reuse or change the existing 18 instance. Availability of an exact 17.6 installer has not been verified. No installation was performed.

## Baseline and compatibility requirements

The retained schema-only snapshot reports source PostgreSQL 17.6; it contains no representative data. Verify it is a clean pre-103 baseline, compare schema/owner/role/ACL/RLS/trigger/function/sequence inventories and extensions with a separately provided, non-secret production inventory, and record any differences. Production's migration state cannot be inferred from local files. Supabase Auth roles, service_role and JWT claims, PostgREST behavior, extension names, versions and schema placement, and Vault availability/permissions require explicit checks. Do not import live Vault secrets or encryption keys. Provision only approved synthetic credentials. A plain PostgreSQL instance cannot establish Vault or managed-platform equivalence.

Apply pending 103 through 113 in numeric order only in a later approved validation run. The preceding staging validation report lists each dependency. Repeatability means restore the clean baseline and run the sequence again, not blindly rerun non-idempotent migrations in place. Before/after compare historical rows, business totals, immutable close snapshots, stock movements and sequences; document intentional additive changes.

## Synthetic Phase 2 fixtures

The accompanying JSON supplies fixed test identities, dates, orders, manually recorded cash/card/mobile tenders, shared stock and movements, an intended manager close, and concrete 65%/replenishment arithmetic. It is a deterministic fixture specification, not a runnable or tested database seed. A staging-safe loader still needs implementation and validation against the actual Phase 2 constraints and sign-off semantics. The close is a manager sign-off fixture, not an assertion of cryptographic signing. Preserve actual Phase 2 invariants; no fabricated pass or historical-row rewrite.

The existing scripts/test-offline-migration-full-schema.mjs owns a disposable local cluster and drops/recreates public schema and creates roles. It must not be aimed at a managed or shared staging database. It also hardcodes localVersion 18 in evidence even if POSTGRES_TEST_BIN points to another version. A separate staging-safe runner and truthful server version capture are necessary before managed execution. Existing modules exercise migrations and include non-deterministic identifiers and current dates; inspect and adapt their setup for these fixed fixtures without weakening assertions. Do not run a destructive reset on a shared database.

## To begin validation

1. Obtain explicit authorization and an isolated Supabase staging project/branch, identify its project reference and safe credentials out of band, and verify billing and outbound-integration isolation.
2. Provide/confirm a vetted pre-103 schema-only baseline and a current non-secret production compatibility inventory without connecting to production during this work; reconcile roles, features, extensions and migration history. Confirm whether exact PostgreSQL version differs.
3. Implement and review a staging-safe fixture loader and runner with project allowlisting, explicit opt-in, duplicate-key refusal and no schema reset; validate deterministic fixture totals and the baseline before applying migrations.
4. Agree on safe clean-baseline recreation for two runs, capture version and migration logs and assertion counts, and run 103–113 plus the complete financial, allocation, authorization and reconciliation regressions in the next validation task.

Current status: no environment provisioned, no fixture loader executed, no SQL assertions run; compatibility is unverified. Prior PostgreSQL 18 test evidence remains historical only. NO-GO for claiming migration compatibility until the isolated validation is performed.

References: https://supabase.com/docs/guides/deployment/branching ; https://supabase.com/docs/guides/platform/manage-your-usage/branching ; https://supabase.com/docs/guides/database/extensions ; https://supabase.com/docs/guides/database/vault ; https://www.postgresql.org/download/windows/ .
