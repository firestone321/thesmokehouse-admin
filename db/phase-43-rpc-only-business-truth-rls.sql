begin;

-- Phase 43: RPC/server-only mutation surface for business-truth tables.
-- Admin users keep read access through existing SELECT policies, but direct
-- browser-authenticated writes to orders, payment, and stock ledgers are removed.
-- Operational mutations should flow through service-role server actions and
-- locked RPCs such as mark_order_as_paid(...), transition_order_status(...),
-- reserve_paid_order_stock(...), release_reserved_order_stock(...), and
-- finalize_reserved_order_sale(...).

drop policy if exists "daily_stock_admin_roles_write" on public.daily_stock;
drop policy if exists "inventory_items_admin_roles_write" on public.inventory_items;
drop policy if exists "inventory_movements_admin_roles_write" on public.inventory_movements;
drop policy if exists "procurement_receipts_admin_roles_write" on public.procurement_receipts;
drop policy if exists "finished_stock_admin_roles_write" on public.finished_stock;
drop policy if exists "finished_stock_movements_admin_roles_write" on public.finished_stock_movements;
drop policy if exists "processing_batches_admin_roles_write" on public.processing_batches;
drop policy if exists "orders_admin_roles_write" on public.orders;
drop policy if exists "order_items_admin_roles_write" on public.order_items;
drop policy if exists "order_status_events_admin_roles_write" on public.order_status_events;
drop policy if exists "payment_attempts_admin_roles_write" on public.payment_attempts;

revoke insert, update, delete on table
  public.daily_stock,
  public.inventory_items,
  public.inventory_movements,
  public.procurement_receipts,
  public.finished_stock,
  public.finished_stock_movements,
  public.processing_batches,
  public.orders,
  public.order_items,
  public.order_status_events,
  public.payment_attempts
from anon, authenticated;

comment on table public.orders is
  'Business-truth table: direct anon/authenticated writes are revoked. Mutate through service-role server actions and locked RPCs only.';

comment on table public.daily_stock is
  'Business-truth stock ledger: direct anon/authenticated writes are revoked. Mutate through service-role server actions and locked RPCs only.';

comment on table public.finished_stock is
  'Durable stock truth: direct anon/authenticated writes are revoked. Mutate through service-role server actions and locked RPCs only.';

comment on table public.payment_attempts is
  'Payment audit/truth table: direct anon/authenticated writes are revoked. Mutate through service-role server actions and locked RPCs only.';

commit;
