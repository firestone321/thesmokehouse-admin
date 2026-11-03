# Phase 3C deployment and recovery runbook

> Phase 3D policy update: when migration 113 is applied, the new initial allocation is 65% with a fixed starting target and controlled consumed-only replenishment. See [Phase 3D rollout notes](phase-3d-rollout-notes.md). The 35% references below describe the earlier 103–112 behavior.

Prepared 2026-10-31. Development artifacts only. Nothing here authorizes production execution.

## Release gates

Keep offline cash disabled until the reviewed Admin, database and Windows bridge versions are coordinated. Initial policy is one manager-enrolled Windows journal; phones use the online Admin POS. Continue the functioning Phase 2 workflow during preparation.

Required acceptance:

- Repeat migration and regression validation against a disposable PostgreSQL 17.6 environment matching Supabase; the current local full-schema test uses PostgreSQL 18 and the real 17.6 schema snapshot. No Vault stub is substituted.
- Review migrations 103–112 and immutable financial evidence protections. Inventory and signed daily-close owners approve reconciliation semantics.
- Exercise a real independent backup destination and separately escrowed encryption key. Verify physical independence; a different drive letter can still be the same disk. Prefer a separately secured NAS/off-device volume. Confirmation flags are operator assertions, not physical-device attestation.
- Complete a supervised restore drill with an older and a current checkpoint, preserving original transaction IDs and hardware history. A backup cannot prove that an unknown unsynchronized tail never existed.
- Validate protected Windows accounts/DACLs, startup/task ownership, stop/restart and access to the backup share. Use Node 24 or newer for offline SQLite.
- Perform separately authorized physical receipt/drawer acceptance on the intended Windows account after code review. No physical commands were executed during development.
- Verify manager and cashier roles, bounded grants, clock/timezone, terminal enrollment, backup monitoring and disabling new cash while allowing existing synchronization.

## Configuration inventory

Admin (protected deployment settings, absent/false by default):

    POS_OFFLINE_ENABLED=false
    POS_OFFLINE_SYNC_ENABLED=false
    POS_OFFLINE_OPERATIONS_ENABLED=false
    POS_OFFLINE_GRANT_ISSUER=<stable issuer>
    POS_OFFLINE_GRANT_PRIVATE_JWK_B64=<protected private Ed25519 JWK>
    POS_OFFLINE_GRANT_VERIFYING_JWKS_B64=<base64url public {"keys":[...]} history>

The private signing key and Supabase service-role credentials stay on the Admin server. Record only public key history in the manager rotation interface. The existing receipt/drawer signing configuration remains independent.

Bridge:

    OFFLINE_POS_ENABLED=false
    OFFLINE_SYNC_ENABLED=false
    OFFLINE_OPERATIONS_ENABLED=false
    OFFLINE_BACKUP_ENABLED=false
    OFFLINE_UNATTENDED_ENABLED=false
    OFFLINE_NEW_SALES_DISABLED=true
    OFFLINE_REQUIRE_VERIFIED_BACKUP=false
    OFFLINE_MAX_UNBACKED_MS=600000
    OFFLINE_BACKUP_INTERVAL_MS=300000
    OFFLINE_BACKUP_RETENTION_DAYS=30
    OFFLINE_BACKUP_MAX_FILES=1000
    OFFLINE_BACKUP_DESTINATION=<independent absolute destination>
    OFFLINE_BACKUP_KEY_FILE=<protected local 32-byte base64url key file>
    OFFLINE_BACKUP_DESTINATION_INDEPENDENT=false
    OFFLINE_BACKUP_KEY_ESCROW_CONFIRMED=false
    OFFLINE_TERMINAL_PRIVATE_JWK_FILE=<protected local Ed25519 private JWK>
    OFFLINE_TERMINAL_ID=<registered UUID>
    OFFLINE_TERMINAL_EPOCH=<registered UUID>
    OFFLINE_GRANT_ISSUER=<same stable issuer>
    OFFLINE_GRANT_PUBLIC_JWK_B64=<public JWK or public {"keys":[...]} ring>
    OFFLINE_DATA_DIR=<absolute local disk directory outside OneDrive>

Retain the existing bridge origin/authentication/printer configuration. Never expose loopback over the LAN. Never copy the SQLite journal between active terminals.

For an accepted production rollout, require verified backups before enabling new cash: OFFLINE_REQUIRE_VERIFIED_BACKUP=true and an agreed maximum unbacked interval. The sample remains inert; it does not activate this policy or cash sales. Backups require a 100 MB minimum free-space reserve plus snapshot/encryption headroom on both source and target. A backup configuration failure is recorded and synchronization continues; the optional freshness guard blocks new cash independently.

## Coordinated rollout order (requires separate authorization)

1. Back up the cloud database, current Windows configuration and original local journal/key custody. Record pending financial/hardware states and current main/release references. Do not discard any outbox.
2. Apply additive migrations in order: 103 foundations, 104 order width, 105 reporting, 106 ingestion, 107 settlements, 108 operations, 109 reconciliation, 110 management views, 111 recovery, 112 issuance/journal binding. Verify existing migration state first; do not blindly rerun non-idempotent scripts. Do not change production sequences or historical orders.
3. Deploy the reviewed Admin with all new offline flags false. Validate current Phase 2 online cash/card/mobile-money, recovery and receipt-only reprint workflows.
4. Stop the original journal owner gracefully. Install the reviewed Node 24 bridge build in a reviewed maintenance window, preserving journal, identity marker, keys and hardware ledger. SQLite v1/v2 upgrades to v3 transactionally; unknown/corrupt schema fails closed. Do not replace the directory with an empty one.
5. Configure local key-file custody, public verification history and protected storage. The prepared identity generator creates a fresh private key file and prints public identity only; do not regenerate an existing key as routine startup behavior.
6. Configure and test independent encrypted backups and key escrow. Check verified sequence, pending count and checkpoint age. Initial backup can run on an empty journal before cash is enabled.
7. Enable management/sync only after infrastructure acceptance. Use the original Windows bridge's fresh nonce-signed enrollment proof to enroll a fresh empty journal, or explicitly bind an existing upgraded original journal. Server registration permanently binds journal UUID, key and epoch. A new empty directory cannot use the old journal's signed identity receipt.
8. Fund an explicitly approved catalog. Minimum/default is ceil(35% of eligible available physical source stock); larger requests require manager approval. No automatic replenishment. Provision a live cashier while online; the response contains the bounded cash grant plus an identity-only journal receipt. The receipt is permanent identity metadata, not permission to take cash. Cash permission still expires within 12 hours and allocation/service-day limits.
9. Keep OFFLINE_NEW_SALES_DISABLED=true until manager review, independent backups and separately authorized end-to-end acceptance have passed. Enable new cash only with later explicit authorization.

## Daily operations

Inspect /pos/offline-operations as a live manager. Records show original UUID, cashier, terminal/epoch/sequence, service date, receipt reference, cash total, canonical order mapping, original signatures/hash and audited decisions. Tokens/PIN/private keys are not displayed. Reported terminal metadata is last known information, not access to its SQLite file.

Use known UUID lookup when switching devices. A phone has no access to an offline PC's journal. An unknown cloud UUID does not prove the physical sale failed. Never recreate a pending sale automatically. Escalate suspected independent physical duplicates to manager review.

Reports are scheduled every 30 seconds when connected; UI freshness becomes stale after two minutes. Network interruptions keep synchronization retries active. Suspension/revocation cannot instantly reach a disconnected terminal. Current grant exposure is at most its remaining lifetime, capped at 12 hours and allocation expiry, subject to remaining reserved stock. Operators must separately contain a lost terminal.

Manager actions:

- Confirm genuine: post missing canonical order/tender/settlement from original verified evidence atomically, including a disabled cashier's valid historical capture. Never submit a replacement browser sale.
- Flag duplicate: record investigation only. Confirmed duplicate explicitly references a matching canonical paid POS order; no new tender or stock sale is invented. Independent UUIDs are not automatically considered duplicates.
- Resolve late close: add one reviewed adjustment to immutable signed-close expectation. Do not add a second tender or rewrite the snapshot.
- Close incident: only after an explicit financial outcome; closing a label cannot replace posting missing effects.
- Conflicting signed payloads remain archived; investigation does not authorize rewriting or posting one automatically.

Original ingestion acknowledgement is immutable. Manager resolutions are separate cloud decisions and separate locally signed SQLite certificates, bound to original UUID and payload hash. A cloud resolution can remove a quarantined local item from pending without changing its original evidence.

## Allocation closure and stock

Use the local manager closure button on the original PC after every pending/uncertain sale and draft is resolved. The server issues a five-minute, action-specific manager permit. The bridge durably signs a complete contiguous terminal sequence/transaction/resource manifest, checks residual budgets, closes local spending and sends evidence on the next operations cycle.

The server validates the complete manifest against all original cloud identities and approved outcomes. Returning unused stock additionally waits for grant/allocation expiry. Terminal lock precedes closure validation and settlement/return; each allocation/resource return has a unique immutable row. Retry cannot return stock twice.

In physical source units:

- F = funded original quantity.
- S = canonical settled quantity.
- C = locally consumed quantity from durable closure (a last report is only indicative).
- R = already returned quantity.
- Outstanding cloud hold = F - S - R.
- Proven unused total = F - C.
- Releasable proven unused = F - C - R.
- Unresolved consumed hold after proven returns = C - S.

An expired grant, terminal silence, zero pending report, stale backup, or incident label never releases stock. Confirmed duplicate consumption deliberately remains held until separate verified stock reconciliation; do not call those units unused. Lost/damaged terminals without trustworthy closure retain their holds. A fresh replacement allocation uses only genuinely available remaining stock.

## Backups and supervised disaster recovery

Automatic backup work runs on a read-only SQLite connection in a worker thread. VACUUM INTO creates a consistent snapshot under the protected local journal directory. Integrity/FK/schema/financial/grant/acknowledgement signatures and contiguous sequence are checked, then AES-256-GCM encryption is fsynced and read back/decrypted at the independent destination. Only ciphertext is written there. Authenticated index watermarks prevent a stale journal from replacing a higher checkpoint. Retention validates old evidence before deleting it, never removes a higher sequence, and keeps the new verified checkpoint. Failed backups are visible separately from last good recovery point.

Escrow the AES key independently of both terminal and backup destination. Do not store keys in source control, reports or manager text fields. NTFS permissions and protected share permissions must be reviewed: POSIX mode 0600 alone is not a Windows ACL guarantee.

Recovery:

1. Fence/revoke the original epoch through a real manager. If the terminal is physically reachable, stop it as well. Cloud fencing does not disable a disconnected copy instantly.
2. Obtain the ciphertext SHA-256 and request an audited manager recovery permit. It binds backup hash, original terminal/epoch and cloud/report sequence watermark; it expires within 24 hours.
3. With protected key/permit files and retained public verification history, run the prepared CLI only under separately authorized supervision:

       node dist/offline-recovery.js prepare <encrypted-backup> <fresh-journal-path>

   Existing target/identity marker is never overwritten. Stale sequence is rejected by default. OFFLINE_ALLOW_STALE_EVIDENCE=true is an explicit forensic salvage option only; it never proves completeness or allows cash.
4. Restored journal is permanently evidence-only for this workflow. It preserves original sale IDs/signatures/grants, sequence and hardware states. It cannot take new cash, dispatch old hardware or sign allocation closure. No automatic restore occurs on startup failure.
5. Export original signed evidence to a fresh protected directory:

       node dist/offline-recovery.js export <evidence-only-journal> <fresh-output-directory>

6. Import batches through the manager recovery UI. Server checks original capture-time grant/signatures, registered key, fenced epoch and permit. Known UUIDs return existing outcomes; unknown genuine captures remain review evidence until explicit manager approval. Preserve the export, backup and audit trail.
7. Enroll a replacement using a fresh key, journal and epoch. Never activate the recovered journal as a parallel cashier terminal. Unknown tails and stranded stock remain unresolved rather than guessed away.

No periodic backup can guarantee recovery of cash committed after its last checkpoint. A disk failure between checkpoints is residual risk; use UPS/storage health controls and agreed RPO. Backup key loss makes decryption impossible. This implementation does not claim TPM-level anti-cloning against a privileged OS administrator copying all keys/files.

## Unattended Windows ownership

Decision: preserve interactive printing as the default. The optional unattended entry point owns the same journal exclusively and runs sync/management/backups with hardware methods disabled; it exposes no local POS HTTP server and forces new cash disabled. It is not a second concurrent writer.

Prepared scripts (not installed/executed):

- scripts/install-offline-sync-task.ps1 registers a disabled AtStartup task only with explicit -Install and exclusive-owner acknowledgement; dedicated least-privileged credential, one instance, one-minute restart interval, no execution time limit.
- scripts/switch-offline-owner.ps1 stops configured tasks, waits for the original PID to exit, never deletes lock/journal, then starts the chosen owner.
- scripts/set-offline-storage-acl.ps1 prepares explicit journal-owner and read-only secret-file permissions; inspect with -WhatIf before a reviewed application.

Manual reviewed handover is required between unattended and interactive modes. Automatic failover/service installation and printer access across Windows sessions have not been certified. Do not enable both startup owners. Accept task credentials, share access, graceful shutdown and spooler behavior on the actual Windows machine first.

Microsoft reference: [Register-ScheduledTask](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/register-scheduledtask) and [New-ScheduledTaskSettingsSet](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset).

## Rollback without evidence loss

Stop NEW cash first using OFFLINE_NEW_SALES_DISABLED=true on the original bridge; suspend/revoke remotely where appropriate. Turn off new server grant issuance with POS_OFFLINE_ENABLED=false. A remote flag alone cannot instantly stop existing disconnected grants.

Keep OFFLINE_POS_ENABLED/runtime, OFFLINE_SYNC_ENABLED, OFFLINE_OPERATIONS_ENABLED and the server ingestion/management endpoints available for already committed sales. These are separate from the new-cash kill switch. Do not disable management identity checks while leaving new cash permitted.

Keep migrations and evidence tables in place. Never roll back by deleting imported orders, cash tenders, settlements, decisions, adjustments, allocation holds, outbox, journal, identity marker, key history or hardware action rows. Never reset terminal sequence or order-number sequence.

Do not open a v3 journal using a pre-v3 binary. Roll back UI/new-cash exposure while retaining a compatible sync/recovery owner, or provide a reviewed forward correction. Back up before any later binary update. No down migration that removes financial evidence is supplied.
