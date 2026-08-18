import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

if (!process.argv.includes("--confirm-all-orders")) {
  throw new Error("Refusing to run without --confirm-all-orders.");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase service configuration is missing.");

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const protectedTables = ["menu_categories", "menu_items", "inventory_items", "finished_stock"];
const orderTables = [
  "orders",
  "order_items",
  "order_status_events",
  "payment_attempts",
  "pending_payment_recoveries",
  "pos_tenders",
  "pos_sale_requests",
  "checkout_reservations",
  "admin_push_dispatches",
  "admin_push_dispatch_receipts",
  "push_subscription_orders",
  "push_notification_dispatches"
];

async function countRows(table) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

async function selectAll(table) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from(table).select("*").range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} backup failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function deleteAll(table, column) {
  const { count, error } = await db.from(table).delete({ count: "exact" }).not(column, "is", null);
  if (error) throw new Error(`${table} delete failed: ${error.message}`);
  return count ?? 0;
}

const beforeProtected = Object.fromEntries(
  await Promise.all(protectedTables.map(async (table) => [table, await countRows(table)]))
);
const beforeOrderCounts = Object.fromEntries(
  await Promise.all(orderTables.map(async (table) => [table, await countRows(table)]))
);
if (beforeOrderCounts.orders === 0) throw new Error("There are no orders to reset.");

const backupTables = Object.fromEntries(
  await Promise.all(orderTables.map(async (table) => [table, await selectAll(table)]))
);
const { data: orderActivity, error: activityBackupError } = await db
  .from("staff_activity_log")
  .select("*")
  .or("order_id.not.is.null,entity_type.eq.order");
if (activityBackupError) throw new Error(`staff_activity_log backup failed: ${activityBackupError.message}`);
backupTables.staff_activity_log = orderActivity ?? [];

const backupDirectory = path.resolve("order-reset-backups");
fs.mkdirSync(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const backupPath = path.join(backupDirectory, `orders-before-reset-${stamp}.json`);
fs.writeFileSync(
  backupPath,
  JSON.stringify({ createdAt: new Date().toISOString(), counts: beforeOrderCounts, tables: backupTables }, null, 2),
  { encoding: "utf8", flag: "wx", mode: 0o600 }
);

const deleted = {};
deleted.admin_push_dispatch_receipts = await deleteAll("admin_push_dispatch_receipts", "id");
deleted.admin_push_dispatches = await deleteAll("admin_push_dispatches", "id");
deleted.push_subscription_orders = await deleteAll("push_subscription_orders", "order_id");
deleted.push_notification_dispatches = await deleteAll("push_notification_dispatches", "id");
deleted.checkout_reservations = await deleteAll("checkout_reservations", "idempotency_key");

const { error: pointerError } = await db
  .from("orders")
  .update({ active_payment_attempt_id: null })
  .not("active_payment_attempt_id", "is", null);
if (pointerError) throw new Error(`orders payment pointer reset failed: ${pointerError.message}`);

deleted.pending_payment_recoveries = await deleteAll("pending_payment_recoveries", "id");
deleted.payment_attempts = await deleteAll("payment_attempts", "id");
deleted.pos_tenders = await deleteAll("pos_tenders", "id");
deleted.pos_sale_requests = await deleteAll("pos_sale_requests", "idempotency_key");
deleted.order_items = await deleteAll("order_items", "id");
deleted.order_status_events = await deleteAll("order_status_events", "id");

const { count: activityCount, error: activityDeleteError } = await db
  .from("staff_activity_log")
  .delete({ count: "exact" })
  .or("order_id.not.is.null,entity_type.eq.order");
if (activityDeleteError) throw new Error(`staff_activity_log delete failed: ${activityDeleteError.message}`);
deleted.staff_activity_log = activityCount ?? 0;
deleted.orders = await deleteAll("orders", "id");

const afterOrderCounts = Object.fromEntries(
  await Promise.all(orderTables.map(async (table) => [table, await countRows(table)]))
);
const afterProtected = Object.fromEntries(
  await Promise.all(protectedTables.map(async (table) => [table, await countRows(table)]))
);

if (Object.values(afterOrderCounts).some((count) => count !== 0)) {
  throw new Error(`Order reset verification failed: ${JSON.stringify(afterOrderCounts)}`);
}
if (JSON.stringify(beforeProtected) !== JSON.stringify(afterProtected)) {
  throw new Error(`Protected table counts changed: before=${JSON.stringify(beforeProtected)} after=${JSON.stringify(afterProtected)}`);
}

console.log(JSON.stringify({ backupPath, beforeOrderCounts, deleted, afterOrderCounts, protectedCounts: afterProtected }, null, 2));
