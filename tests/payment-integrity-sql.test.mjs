import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../db/phase-61-pesapal-payment-integrity.sql", import.meta.url),
  "utf8"
);
const schedulerSql = readFileSync(
  new URL("../db/phase-62-independent-payment-recovery-scheduler.sql", import.meta.url),
  "utf8"
);

test("payment verification locks both the order and attempt rows", () => {
  const locks = sql.match(/for update;/gi) ?? [];
  assert.ok(locks.length >= 4, "expected locks in verification and rejection transitions");
});

test("payment verification checks every required paid binding", () => {
  assert.match(sql, /supplied_tracking_id_binding_mismatch/);
  assert.match(sql, /provider_tracking_id_binding_mismatch/);
  assert.match(sql, /merchant_reference_binding_mismatch/);
  assert.match(sql, /provider_amount_binding_mismatch/);
  assert.match(sql, /provider_currency_binding_mismatch/);
  assert.match(sql, /v_status = 'COMPLETED'/);
});

test("paid downgrade protection covers orders and payment attempts", () => {
  assert.match(sql, /orders_prevent_paid_payment_downgrade/);
  assert.match(sql, /payment_attempts_prevent_paid_payment_downgrade/);
  assert.match(sql, /paid_payment_status_cannot_be_downgraded/);
});

test("cancellation requires explicit provider confirmation", () => {
  assert.match(sql, /provider_cancellation_confirmation_required/);
  assert.match(sql, /p_cancellation_confirmed/);
});

test("RPC privileges are limited to the service role", () => {
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
});

test("recovery scheduler is a five-minute demand-gated watchdog using Vault secrets", () => {
  assert.match(schedulerSql, /smokehouse-pending-payment-recovery/);
  assert.match(schedulerSql, /'\*\/5 \* \* \* \*'/);
  assert.match(schedulerSql, /vault\.decrypted_secrets/);
  assert.match(schedulerSql, /smokehouse_payment_recovery_cron_secret/);
  assert.match(schedulerSql, /where exists \(/);
  assert.match(schedulerSql, /pending_payment_recoveries/);
  assert.match(schedulerSql, /cron\.job_run_details/);
  assert.match(schedulerSql, /interval '7 days'/);
});
