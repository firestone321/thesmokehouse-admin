-- Full operational reset for Firestone Smokehouse.
--
-- Intentionally preserves:
--   - auth.users and all public.profiles/public.customers rows and roles
--   - database schema, functions, RLS policies, cron/Vault configuration,
--     storage bucket definitions, and payment_provider_config
--
-- Intentionally deletes:
--   orders, payments, checkout state, all push subscriptions/history,
--   menu/inventory/procurement/stock/processing/supplier records, incidents,
--   rate-limit and replay state, and every business reference catalogue row.
--
-- This file does NOT delete Storage objects. After this transaction commits,
-- delete the menu-item-images objects through the Storage API; do not delete
-- storage.objects rows directly because that can leave orphaned files.
--
-- Review the whole file and obtain a fresh live count before running it.

begin;

do $$
declare
  v_missing_tables text[];
begin
  select array_agg(table_name order by table_name)
  into v_missing_tables
  from unnest(array[
    'admin_push_dispatch_receipts',
    'admin_push_dispatches',
    'admin_push_drain_lock',
    'admin_push_subscriptions',
    'api_rate_limits',
    'checkout_reservations',
    'daily_stock',
    'finished_stock',
    'finished_stock_movements',
    'internal_token_replay',
    'inventory_items',
    'inventory_movements',
    'menu_categories',
    'menu_item_components',
    'menu_items',
    'ops_incidents',
    'order_items',
    'order_status_events',
    'orders',
    'packaging_types',
    'payment_attempts',
    'pending_payment_recoveries',
    'portion_types',
    'processing_batches',
    'procurement_receipts',
    'protein_intake_item_portions',
    'protein_intake_items',
    'proteins',
    'push_notification_dispatches',
    'push_subscription_orders',
    'push_subscriptions',
    'suppliers'
  ]) as required(table_name)
  where to_regclass(format('public.%I', table_name)) is null;

  if v_missing_tables is not null then
    raise exception 'Full operational reset stopped: required tables are missing: %', v_missing_tables;
  end if;
end;
$$;

-- Prevent new checkout, procurement, stock, and notification writes while the
-- reset is in progress. These locks are released automatically on commit/rollback.
lock table
  public.admin_push_dispatch_receipts,
  public.admin_push_dispatches,
  public.admin_push_drain_lock,
  public.admin_push_subscriptions,
  public.api_rate_limits,
  public.checkout_reservations,
  public.daily_stock,
  public.finished_stock,
  public.finished_stock_movements,
  public.internal_token_replay,
  public.inventory_items,
  public.inventory_movements,
  public.menu_categories,
  public.menu_item_components,
  public.menu_items,
  public.ops_incidents,
  public.order_items,
  public.order_status_events,
  public.orders,
  public.packaging_types,
  public.payment_attempts,
  public.pending_payment_recoveries,
  public.portion_types,
  public.processing_batches,
  public.procurement_receipts,
  public.protein_intake_item_portions,
  public.protein_intake_items,
  public.proteins,
  public.push_notification_dispatches,
  public.push_subscription_orders,
  public.push_subscriptions,
  public.suppliers
in access exclusive mode;

-- Clear all order/payment and notification state. The active payment pointer
-- must be null before payment attempts can be removed.
delete from public.admin_push_dispatch_receipts;
delete from public.admin_push_dispatches;
delete from public.admin_push_subscriptions;
delete from public.push_subscription_orders;
delete from public.push_notification_dispatches;
delete from public.push_subscriptions;
delete from public.checkout_reservations;
update public.orders set active_payment_attempt_id = null where active_payment_attempt_id is not null;
delete from public.pending_payment_recoveries;
delete from public.payment_attempts;
delete from public.order_items;
delete from public.order_status_events;
delete from public.orders;

-- Clear stock, purchasing, supplier, menu, inventory, and catalogue data in
-- foreign-key-safe order.
delete from public.finished_stock_movements;
delete from public.processing_batches;
delete from public.finished_stock;
delete from public.daily_stock;
delete from public.procurement_receipts;
delete from public.menu_item_components;
delete from public.menu_items;
delete from public.inventory_movements;
delete from public.inventory_items;
delete from public.protein_intake_item_portions;
delete from public.protein_intake_items;
delete from public.suppliers;
delete from public.menu_categories;
delete from public.portion_types;
delete from public.proteins;
delete from public.packaging_types;

-- Clear operational diagnostics and short-lived internal state. Deliberately
-- leave payment_provider_config and all user/profile records intact.
delete from public.ops_incidents;
delete from public.api_rate_limits;
delete from public.internal_token_replay;
delete from public.admin_push_drain_lock;

-- Reset all deleted identity-backed operational tables so the new setup begins
-- from clean IDs. This does not touch profiles/customers/auth users.
do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array[
    'admin_push_drain_lock',
    'finished_stock_movements',
    'inventory_items',
    'inventory_movements',
    'menu_categories',
    'menu_item_components',
    'menu_items',
    'ops_incidents',
    'order_items',
    'order_status_events',
    'orders',
    'packaging_types',
    'payment_attempts',
    'pending_payment_recoveries',
    'portion_types',
    'processing_batches',
    'procurement_receipts',
    'protein_intake_items',
    'proteins',
    'suppliers'
  ] loop
    select pg_get_serial_sequence(format('public.%I', v_table), 'id') into v_sequence;
    if v_sequence is not null then
      perform setval(v_sequence::regclass, 1, false);
    end if;
  end loop;
end;
$$;

-- Make the next generated order number exactly 001, then 002, and so on.
alter sequence public.order_number_seq minvalue 1 restart with 1;

create or replace function public.generate_order_number()
returns text
language plpgsql
as $$
declare
  v_next bigint;
begin
  v_next := nextval('public.order_number_seq');
  return lpad(v_next::text, 3, '0');
end;
$$;

commit;

-- Post-reset verification. Every operational/catalogue count below must be 0;
-- profiles and customers must retain their current counts.
select 'orders' as table_name, count(*) as row_count from public.orders
union all select 'menu_items', count(*) from public.menu_items
union all select 'inventory_items', count(*) from public.inventory_items
union all select 'procurement_receipts', count(*) from public.procurement_receipts
union all select 'suppliers', count(*) from public.suppliers
union all select 'proteins', count(*) from public.proteins
union all select 'packaging_types', count(*) from public.packaging_types
union all select 'portion_types', count(*) from public.portion_types
union all select 'menu_categories', count(*) from public.menu_categories
union all select 'push_subscriptions', count(*) from public.push_subscriptions
union all select 'admin_push_subscriptions', count(*) from public.admin_push_subscriptions
union all select 'profiles_preserved', count(*) from public.profiles
union all select 'customers_preserved', count(*) from public.customers
order by table_name;

select
  case
    when last_value = 1 and is_called = false then '001'
    else 'unexpected sequence state'
  end as next_order_number
from public.order_number_seq;
