-- One-time guarded cleanup requested on 2026-09-02.
-- Deletes only orders 053-057, restores their exact Fries Large stock effects,
-- renumbers the three surviving orders to 001-003, and makes the next order 004.

begin;

do $$
declare
  v_target_ids constant bigint[] := array[53, 54, 55, 56, 57];
  v_survivor_ids constant bigint[] := array[41, 42, 52];
  v_count integer;
  v_finished_quantity integer;
  v_reserved_quantity integer;
  v_sold_quantity integer;
begin
  -- Lock the complete current order set. Abort if another order has appeared or
  -- any expected row has disappeared since the production read-only baseline.
  perform 1
  from public.orders
  order by id
  for update;

  select count(*) into v_count from public.orders;
  if v_count <> 8 then
    raise exception 'cleanup_expected_8_total_orders_found_%', v_count;
  end if;

  if exists (
    select 1
    from public.orders
    where id <> all(v_target_ids)
      and id <> all(v_survivor_ids)
  ) then
    raise exception 'cleanup_unexpected_order_id_present';
  end if;

  select count(*) into v_count
  from public.orders
  where id = any(v_target_ids);
  if v_count <> 5 then
    raise exception 'cleanup_expected_5_target_orders_found_%', v_count;
  end if;

  if exists (
    select 1
    from public.orders
    where id = any(v_target_ids)
      and (
        order_number <> lpad(id::text, 3, '0')
        or service_date <> date '2026-09-02'
        or total_amount <> 500
        or order_source not in ('storefront', 'pos')
        or case id
          when 53 then not (order_source = 'storefront' and status = 'completed' and payment_status = 'paid' and stock_reservation_status = 'finalized')
          when 54 then not (order_source = 'storefront' and status = 'cancelled' and payment_status = 'cancelled' and stock_reservation_status = 'not_started')
          when 55 then not (order_source = 'storefront' and status = 'completed' and payment_status = 'paid' and stock_reservation_status = 'finalized')
          when 56 then not (order_source = 'storefront' and status = 'completed' and payment_status = 'paid' and stock_reservation_status = 'finalized')
          when 57 then not (order_source = 'pos' and status = 'confirmed' and payment_status = 'paid' and stock_reservation_status = 'reserved')
          else true
        end
      )
  ) then
    raise exception 'cleanup_target_order_baseline_changed';
  end if;

  select count(*) into v_count
  from public.order_items
  where order_id = any(v_target_ids)
    and menu_item_id = 9
    and menu_item_name = 'Fries large'
    and quantity = 1
    and unit_price = 500;
  if v_count <> 5
     or (select count(*) from public.order_items where order_id = any(v_target_ids)) <> 5 then
    raise exception 'cleanup_target_items_changed';
  end if;

  -- Four paid orders each consumed two Fries stock units. The three completed
  -- storefront orders are finalized/sold; the POS order remains reserved.
  select count(*) into v_count
  from public.finished_stock_movements as m
  join public.orders as o
    on m.note = format(
      'Paid confirmation stock consumption for order %s (%s).',
      o.id,
      o.order_number
    )
  where o.id = any(array[53, 55, 56, 57]::bigint[])
    and m.portion_type_id = 10
    and m.movement_type = 'sale'
    and m.quantity_delta = -2;
  if v_count <> 4 then
    raise exception 'cleanup_expected_4_stock_movements_found_%', v_count;
  end if;

  select current_quantity into v_finished_quantity
  from public.finished_stock
  where portion_type_id = 10
  for update;
  if not found or v_finished_quantity <> 264 then
    raise exception 'cleanup_expected_finished_stock_264_found_%', v_finished_quantity;
  end if;

  select reserved_quantity, sold_quantity
  into v_reserved_quantity, v_sold_quantity
  from public.daily_stock
  where stock_date = date '2026-09-02'
    and portion_type_id = 10
  for update;
  if not found or v_reserved_quantity <> 2 or v_sold_quantity <> 6 then
    raise exception
      'cleanup_expected_daily_reserved_2_sold_6_found_reserved_%_sold_%',
      v_reserved_quantity,
      v_sold_quantity;
  end if;

  -- Verify the restrictive dependencies that must be removed explicitly.
  if (select count(*) from public.checkout_reservations where order_id = any(v_target_ids)) <> 4 then
    raise exception 'cleanup_checkout_reservation_count_changed';
  end if;
  if (select count(*) from public.pos_tenders where order_id = any(v_target_ids)) <> 1 then
    raise exception 'cleanup_pos_tender_count_changed';
  end if;
  if (select count(*) from public.pos_sale_requests where order_id = any(v_target_ids)) <> 1 then
    raise exception 'cleanup_pos_request_count_changed';
  end if;
  if (select count(*) from public.payment_attempts where order_id = any(v_target_ids)) <> 4 then
    raise exception 'cleanup_payment_attempt_count_changed';
  end if;
  if (
    select count(*)
    from public.online_receipt_print_jobs
    where order_id = any(v_target_ids)
      and status = 'accepted'
  ) <> 3 then
    raise exception 'cleanup_receipt_print_job_count_changed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.staff_activity_log'::regclass
      and tgname = 'staff_activity_log_prevent_update_delete'
      and tgenabled = 'O'
      and not tgisinternal
  ) then
    raise exception 'cleanup_staff_activity_guard_not_enabled';
  end if;

  -- Restore only the stock consumed by these four paid test orders.
  update public.daily_stock
  set reserved_quantity = reserved_quantity - 2,
      sold_quantity = sold_quantity - 6
  where stock_date = date '2026-09-02'
    and portion_type_id = 10;

  update public.finished_stock
  set current_quantity = current_quantity + 8
  where portion_type_id = 10
  returning current_quantity into v_finished_quantity;

  insert into public.finished_stock_movements (
    portion_type_id,
    movement_type,
    quantity_delta,
    resulting_quantity,
    processing_batch_id,
    note
  ) values (
    10,
    'adjustment',
    8,
    v_finished_quantity,
    null,
    'Reversed 2026-09-02 USh 500 test orders 053-057: 2 reserved and 6 sold Fries units restored.'
  );

  -- Remove restrictive children. Other operational child rows cascade when
  -- their parent order is deleted.
  delete from public.pos_tenders
  where order_id = any(v_target_ids);

  delete from public.pos_sale_requests
  where order_id = any(v_target_ids);

  delete from public.checkout_reservations
  where order_id = any(v_target_ids);

  update public.orders
  set active_payment_attempt_id = null
  where id = any(v_target_ids)
    and active_payment_attempt_id is not null;

  -- Keep append-only activity history, but allow the FK's ON DELETE SET NULL
  -- maintenance for these exact parent rows. Transaction rollback restores the
  -- trigger automatically if any later guard fails.
  alter table public.staff_activity_log
    disable trigger staff_activity_log_prevent_update_delete;

  delete from public.orders
  where id = any(v_target_ids);
  get diagnostics v_count = row_count;
  if v_count <> 5 then
    raise exception 'cleanup_expected_to_delete_5_orders_deleted_%', v_count;
  end if;

  alter table public.staff_activity_log
    enable trigger staff_activity_log_prevent_update_delete;

  -- Renumber the three surviving orders in chronological/id order.
  update public.orders
  set order_number = case id
    when 41 then '001'
    when 42 then '002'
    when 52 then '003'
  end
  where id = any(v_survivor_ids);
  get diagnostics v_count = row_count;
  if v_count <> 3 then
    raise exception 'cleanup_expected_to_renumber_3_orders_updated_%', v_count;
  end if;

  -- Keep resumable checkout snapshots and printable receipt snapshots aligned
  -- with the surviving orders' new public numbers.
  update public.checkout_reservations as cr
  set order_number = o.order_number,
      result_json = case
        when cr.result_json is null then null
        else jsonb_set(cr.result_json, '{order_number}', to_jsonb(o.order_number), true)
      end
  from public.orders as o
  where cr.order_id = o.id
    and o.id = any(v_survivor_ids);

  update public.online_receipt_print_jobs as j
  set receipt = jsonb_set(j.receipt, '{saleId}', to_jsonb(o.order_number), true)
  from public.orders as o
  where j.order_id = o.id
    and o.id = any(v_survivor_ids);

  -- Keep stock movement descriptions aligned with the surviving public order
  -- numbers without deleting the immutable movement history.
  update public.finished_stock_movements as m
  set note = replace(
    replace(
      replace(m.note, 'order 41 (041)', 'order 41 (001)'),
      'order 42 (042)', 'order 42 (002)'
    ),
    'order 52 (052)', 'order 52 (003)'
  )
  where m.note like '%order 41 (041)%'
     or m.note like '%order 42 (042)%'
     or m.note like '%order 52 (052)%';

  alter sequence public.order_number_seq minvalue 1;
  perform setval('public.order_number_seq', 3, true);

  -- Final in-transaction assertions. Any mismatch rolls back every mutation.
  if exists (select 1 from public.orders where id = any(v_target_ids)) then
    raise exception 'cleanup_target_orders_still_present';
  end if;
  if (select count(*) from public.orders) <> 3
     or exists (
       select 1 from public.orders
       where (id = 41 and order_number <> '001')
          or (id = 42 and order_number <> '002')
          or (id = 52 and order_number <> '003')
     ) then
    raise exception 'cleanup_survivor_renumber_readback_failed';
  end if;
  if v_finished_quantity <> 272
     or (select reserved_quantity from public.daily_stock where stock_date = date '2026-09-02' and portion_type_id = 10) <> 0
     or (select sold_quantity from public.daily_stock where stock_date = date '2026-09-02' and portion_type_id = 10) <> 0 then
    raise exception 'cleanup_stock_readback_failed';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.staff_activity_log'::regclass
      and tgname = 'staff_activity_log_prevent_update_delete'
      and tgenabled = 'O'
      and not tgisinternal
  ) then
    raise exception 'cleanup_staff_activity_guard_not_restored';
  end if;
end;
$$;

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

-- Post-commit operator readback.
select id, order_number, order_source, status, payment_status, service_date, total_amount
from public.orders
order by id;

select stock_date, portion_type_id, starting_quantity, reserved_quantity, sold_quantity, waste_quantity, remaining_quantity
from public.daily_stock
where stock_date = date '2026-09-02'
  and portion_type_id = 10;

select portion_type_id, current_quantity
from public.finished_stock
where portion_type_id = 10;

select last_value, is_called,
  lpad((last_value + case when is_called then 1 else 0 end)::text, 3, '0') as next_order_number
from public.order_number_seq;

select tgname, tgenabled
from pg_catalog.pg_trigger
where tgrelid = 'public.staff_activity_log'::regclass
  and tgname = 'staff_activity_log_prevent_update_delete';
