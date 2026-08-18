begin;

lock table
  public.orders,
  public.order_items,
  public.order_status_events,
  public.payment_attempts,
  public.pending_payment_recoveries,
  public.pos_tenders,
  public.pos_sale_requests,
  public.checkout_reservations,
  public.admin_push_dispatches,
  public.admin_push_dispatch_receipts,
  public.push_subscription_orders,
  public.push_notification_dispatches,
  public.staff_activity_log
in access exclusive mode;

create temporary table order_reset_guard as
select
  (select count(*) from public.menu_categories) as menu_categories,
  (select count(*) from public.menu_items) as menu_items,
  (select count(*) from public.inventory_items) as inventory_items,
  (select count(*) from public.finished_stock) as finished_stock;

delete from public.admin_push_dispatch_receipts;
delete from public.admin_push_dispatches;
delete from public.push_subscription_orders;
delete from public.push_notification_dispatches;
delete from public.checkout_reservations;

update public.orders
set active_payment_attempt_id = null
where active_payment_attempt_id is not null;

delete from public.pending_payment_recoveries;
delete from public.payment_attempts;
delete from public.pos_tenders;
delete from public.pos_sale_requests;
delete from public.order_items;
delete from public.order_status_events;
alter table public.staff_activity_log disable trigger staff_activity_log_prevent_update_delete;
delete from public.staff_activity_log
where order_id is not null
   or entity_type = 'order';
delete from public.orders;
alter table public.staff_activity_log enable trigger staff_activity_log_prevent_update_delete;

do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array[
    'orders',
    'order_items',
    'order_status_events',
    'payment_attempts',
    'pending_payment_recoveries',
    'pos_tenders'
  ] loop
    select pg_get_serial_sequence(format('public.%I', v_table), 'id') into v_sequence;
    if v_sequence is not null then
      perform setval(v_sequence::regclass, 1, false);
    end if;
  end loop;
end;
$$;

alter sequence public.order_number_seq minvalue 1 restart with 1;

do $$
declare
  v_guard order_reset_guard%rowtype;
begin
  select * into v_guard from order_reset_guard;
  if v_guard.menu_categories <> (select count(*) from public.menu_categories)
     or v_guard.menu_items <> (select count(*) from public.menu_items)
     or v_guard.inventory_items <> (select count(*) from public.inventory_items)
     or v_guard.finished_stock <> (select count(*) from public.finished_stock) then
    raise exception 'Order-only reset changed a protected catalogue or stock table.';
  end if;
end;
$$;

commit;

select 'orders' as table_name, count(*) as row_count from public.orders
union all select 'order_items', count(*) from public.order_items
union all select 'order_status_events', count(*) from public.order_status_events
union all select 'payment_attempts', count(*) from public.payment_attempts
union all select 'pending_payment_recoveries', count(*) from public.pending_payment_recoveries
union all select 'pos_tenders', count(*) from public.pos_tenders
union all select 'pos_sale_requests', count(*) from public.pos_sale_requests
union all select 'admin_push_dispatches', count(*) from public.admin_push_dispatches
union all select 'push_notification_dispatches', count(*) from public.push_notification_dispatches
order by table_name;

select 'menu_categories' as protected_table, count(*) as row_count from public.menu_categories
union all select 'menu_items', count(*) from public.menu_items
union all select 'inventory_items', count(*) from public.inventory_items
union all select 'finished_stock', count(*) from public.finished_stock
order by protected_table;
