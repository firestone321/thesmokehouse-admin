-- One-time cleanup for the 2026-08-31 receipt-print tests.
-- Orders 043-050 are walk-in Fries sales; 051 is a paid storefront Fries Large
-- order. The transaction restores their exact stock effects before deleting
-- their operational rows. It intentionally does not rewind order_number_seq.

begin;

do $$
declare
  v_order_numbers constant text[] := array[
    '043', '044', '045', '046', '047', '048', '049', '050', '051'
  ];
  v_target_ids bigint[];
  v_count integer;
  v_requirement_rows integer;
  v_pos_units integer;
  v_online_units integer;
  v_finished_quantity integer;
  v_reserved_quantity integer;
  v_sold_quantity integer;
begin
  -- Lock only the intended orders and fail if any target is absent.
  perform 1
  from public.orders
  where order_number = any(v_order_numbers)
  for update;

  select array_agg(id order by order_number), count(*)
  into v_target_ids, v_count
  from public.orders
  where order_number = any(v_order_numbers);

  if v_count <> 9 then
    raise exception 'test_order_cleanup_expected_9_orders_found_%', v_count;
  end if;

  if exists (
    select 1
    from public.orders
    where id = any(v_target_ids)
      and (
        service_date <> date '2026-08-31'
        or payment_status <> 'paid'
        or (
          order_number between '043' and '050'
          and (
            order_source <> 'pos'
            or status <> 'confirmed'
            or stock_reservation_status <> 'reserved'
          )
        )
        or (
          order_number = '051'
          and (
            order_source <> 'storefront'
            or status <> 'completed'
            or stock_reservation_status <> 'finalized'
          )
        )
      )
  ) then
    raise exception 'test_order_cleanup_order_baseline_changed';
  end if;

  -- Each POS test is one regular Fries. The online test is one Fries Large.
  select count(*)
  into v_count
  from public.order_items
  where order_id = any(v_target_ids);

  if v_count <> 9 or exists (
    select 1
    from public.order_items as oi
    join public.orders as o on o.id = oi.order_id
    where o.id = any(v_target_ids)
      and (
        oi.quantity <> 1
        or (o.order_number between '043' and '050' and oi.menu_item_id <> 8)
        or (o.order_number = '051' and oi.menu_item_id <> 9)
      )
  ) then
    raise exception 'test_order_cleanup_item_baseline_changed';
  end if;

  select
    count(*),
    coalesce(sum(r.quantity_required) filter (where o.order_number between '043' and '050'), 0),
    coalesce(sum(r.quantity_required) filter (where o.order_number = '051'), 0)
  into v_requirement_rows, v_pos_units, v_online_units
  from public.orders as o
  cross join lateral public.get_order_stock_requirements(o.id) as r
  where o.id = any(v_target_ids)
    and r.portion_type_id = 10;

  if v_requirement_rows <> 9 or v_pos_units <> 8 or v_online_units <> 2 then
    raise exception
      'test_order_cleanup_stock_requirements_changed_rows_%_pos_%_online_%',
      v_requirement_rows,
      v_pos_units,
      v_online_units;
  end if;

  if exists (
    select 1
    from public.orders as o
    cross join lateral public.get_order_stock_requirements(o.id) as r
    where o.id = any(v_target_ids)
      and r.portion_type_id <> 10
  ) then
    raise exception 'test_order_cleanup_unexpected_stock_portion';
  end if;

  -- Verify restrictive POS and checkout dependencies before removing them.
  select count(*) into v_count
  from public.pos_tenders
  where order_id = any(v_target_ids);

  if v_count <> 8 then
    raise exception 'test_order_cleanup_expected_8_pos_tenders_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.pos_sale_requests
  where order_id = any(v_target_ids);

  if v_count <> 8 then
    raise exception 'test_order_cleanup_expected_8_pos_requests_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.checkout_reservations
  where order_id = any(v_target_ids);

  if v_count <> 1 then
    raise exception 'test_order_cleanup_expected_1_checkout_reservation_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.payment_attempts
  where order_id = any(v_target_ids)
    and order_id = (
      select id from public.orders where order_number = '051'
    )
    and payment_status = 'paid';

  if v_count <> 1 then
    raise exception 'test_order_cleanup_expected_1_paid_attempt_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.online_receipt_print_jobs
  where order_id = (
    select id from public.orders where order_number = '051'
  )
    and status = 'accepted';

  if v_count <> 1 then
    raise exception 'test_order_cleanup_expected_1_accepted_print_job_found_%', v_count;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.staff_activity_log'::regclass
      and tgname = 'staff_activity_log_prevent_update_delete'
      and tgenabled = 'O'
      and not tgisinternal
  ) then
    raise exception 'test_order_cleanup_staff_activity_guard_not_enabled';
  end if;

  select count(*) into v_count
  from public.finished_stock_movements as movement
  join public.orders as o
    on movement.note = format(
      'Paid confirmation stock consumption for order %s (%s).',
      o.id,
      o.order_number
    )
  where o.id = any(v_target_ids)
    and movement.portion_type_id = 10
    and movement.movement_type = 'sale'
    and movement.quantity_delta = case when o.order_number = '051' then -2 else -1 end;

  if v_count <> 9 then
    raise exception 'test_order_cleanup_expected_9_stock_movements_found_%', v_count;
  end if;

  select current_quantity
  into v_finished_quantity
  from public.finished_stock
  where portion_type_id = 10
  for update;

  if not found or v_finished_quantity < 0 then
    raise exception 'test_order_cleanup_fries_finished_stock_missing';
  end if;

  select reserved_quantity, sold_quantity
  into v_reserved_quantity, v_sold_quantity
  from public.daily_stock
  where stock_date = date '2026-08-31'
    and portion_type_id = 10
  for update;

  if not found or v_reserved_quantity < 8 or v_sold_quantity < 2 then
    raise exception
      'test_order_cleanup_daily_stock_changed_reserved_%_sold_%',
      v_reserved_quantity,
      v_sold_quantity;
  end if;

  -- Reverse only these tests: eight reservations and two finalized sold units.
  update public.daily_stock
  set
    reserved_quantity = reserved_quantity - 8,
    sold_quantity = sold_quantity - 2
  where stock_date = date '2026-08-31'
    and portion_type_id = 10;

  update public.finished_stock
  set current_quantity = current_quantity + 10
  where portion_type_id = 10
  returning current_quantity into v_finished_quantity;

  insert into public.finished_stock_movements (
    portion_type_id,
    movement_type,
    quantity_delta,
    resulting_quantity,
    processing_batch_id,
    note
  )
  values (
    10,
    'adjustment',
    10,
    v_finished_quantity,
    null,
    'Reversed receipt-print test orders 043-051: 8 reserved Fries units and 2 finalized Fries units restored.'
  );

  -- Remove non-cascading child rows first. Other operational children cascade.
  delete from public.pos_tenders
  where order_id = any(v_target_ids);

  delete from public.pos_sale_requests
  where order_id = any(v_target_ids);

  delete from public.checkout_reservations
  where order_id = any(v_target_ids);

  -- The FK intentionally uses ON DELETE SET NULL so audit summaries survive,
  -- but the table's append-only trigger otherwise rejects that FK-maintenance
  -- update. Disable only that one user trigger for the parent delete. Both DDL
  -- statements are transactional, so any later failure restores its old state.
  alter table public.staff_activity_log
    disable trigger staff_activity_log_prevent_update_delete;

  delete from public.orders
  where id = any(v_target_ids);

  get diagnostics v_count = row_count;

  alter table public.staff_activity_log
    enable trigger staff_activity_log_prevent_update_delete;

  if v_count <> 9 then
    raise exception 'test_order_cleanup_expected_to_delete_9_orders_deleted_%', v_count;
  end if;
end;
$$;

commit;
