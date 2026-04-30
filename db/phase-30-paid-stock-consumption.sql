begin;

-- Phase 30: paid stock consumption.
-- Purpose:
-- 1. Preserve the external function name used by payment callbacks/IPNs.
-- 2. Consume durable finished_stock exactly once after payment is verified.
-- 3. Keep daily_stock as the same-day operational ledger, not the durable source of truth.
-- 4. Avoid automatic finished-stock restoration on later paid-order cancellation.

create or replace function public.reserve_paid_order_stock(
  p_order_id bigint
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_existing_daily_stock public.daily_stock%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_now timestamptz := now();
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'Only paid orders can consume paid stock';
  end if;

  if v_order.stock_reserved_at is not null then
    return v_order;
  end if;

  for v_item in
    select
      mi.portion_type_id,
      sum(oi.quantity)::integer as quantity_required
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = p_order_id
    group by mi.portion_type_id
    order by mi.portion_type_id
  loop
    if v_item.portion_type_id is null then
      raise exception 'Order % contains a menu item without a sellable portion type', p_order_id;
    end if;

    select *
    into v_finished_stock
    from public.finished_stock
    where portion_type_id = v_item.portion_type_id
    for update;

    if not found or v_finished_stock.current_quantity < v_item.quantity_required then
      raise exception 'Insufficient finished stock for portion % on paid order %', v_item.portion_type_id, p_order_id;
    end if;

    select *
    into v_existing_daily_stock
    from public.daily_stock
    where stock_date = v_order.service_date
      and portion_type_id = v_item.portion_type_id
    for update;

    if found then
      if v_existing_daily_stock.remaining_quantity < v_item.quantity_required then
        raise exception 'Insufficient service-day stock for portion % on %', v_item.portion_type_id, v_order.service_date;
      end if;

      update public.daily_stock
      set reserved_quantity = reserved_quantity + v_item.quantity_required
      where stock_date = v_order.service_date
        and portion_type_id = v_item.portion_type_id;
    else
      insert into public.daily_stock (
        stock_date,
        portion_type_id,
        starting_quantity,
        reserved_quantity
      )
      values (
        v_order.service_date,
        v_item.portion_type_id,
        v_finished_stock.current_quantity,
        v_item.quantity_required
      );
    end if;

    update public.finished_stock
    set current_quantity = current_quantity - v_item.quantity_required
    where portion_type_id = v_item.portion_type_id
    returning *
    into v_finished_stock;

    insert into public.finished_stock_movements (
      portion_type_id,
      movement_type,
      quantity_delta,
      resulting_quantity,
      processing_batch_id,
      note
    )
    values (
      v_item.portion_type_id,
      'sale',
      -v_item.quantity_required,
      v_finished_stock.current_quantity,
      null,
      format(
        'Paid confirmation stock consumption for order %s (%s).',
        p_order_id,
        coalesce(v_order.order_number, 'no order number')
      )
    );
  end loop;

  update public.orders
  set
    stock_reserved_at = coalesce(stock_reserved_at, v_now),
    stock_reservation_status = 'reserved',
    stock_reservation_error = null,
    stock_reservation_attempted_at = v_now,
    fulfillment_review_required = false,
    fulfillment_review_reason = null
  where id = p_order_id
  returning *
  into v_order;

  return v_order;
end;
$$;

create or replace function public.release_reserved_order_stock(
  p_order_id bigint
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.stock_reserved_at is null then
    return v_order;
  end if;

  -- Paid stock has already been consumed from finished_stock. Do not silently release it.
  if v_order.payment_status = 'paid' then
    return v_order;
  end if;

  for v_item in
    select
      mi.portion_type_id,
      sum(oi.quantity)::integer as quantity_required
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = p_order_id
    group by mi.portion_type_id
    order by mi.portion_type_id
  loop
    update public.daily_stock
    set reserved_quantity = greatest(reserved_quantity - v_item.quantity_required, 0)
    where stock_date = v_order.service_date
      and portion_type_id = v_item.portion_type_id;
  end loop;

  update public.orders
  set
    stock_reserved_at = null,
    stock_reservation_status = 'released'
  where id = p_order_id
  returning *
  into v_order;

  return v_order;
end;
$$;

create or replace function public.finalize_reserved_order_sale(
  p_order_id bigint
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.stock_reserved_at is null then
    raise exception 'Order % does not have paid consumed stock to finalize', p_order_id;
  end if;

  for v_item in
    select
      mi.portion_type_id,
      sum(oi.quantity)::integer as quantity_required
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = p_order_id
    group by mi.portion_type_id
    order by mi.portion_type_id
  loop
    update public.daily_stock
    set
      reserved_quantity = greatest(reserved_quantity - v_item.quantity_required, 0),
      sold_quantity = sold_quantity + v_item.quantity_required
    where stock_date = v_order.service_date
      and portion_type_id = v_item.portion_type_id;
  end loop;

  update public.orders
  set stock_reservation_status = 'finalized'
  where id = p_order_id
  returning *
  into v_order;

  return v_order;
end;
$$;

-- Reconciliation helpers for launch/audit runs:
-- Paid orders needing stock review:
-- select id, order_number, payment_status, stock_reserved_at, stock_reservation_status, stock_reservation_error
-- from public.orders
-- where payment_status = 'paid'
--   and (stock_reserved_at is null or stock_reservation_status = 'failed')
-- order by created_at desc;
--
-- Possible duplicate paid-sale movement rows for the same order:
-- select regexp_match(note, 'order ([0-9]+)') as order_match, portion_type_id, count(*) as movement_count
-- from public.finished_stock_movements
-- where movement_type = 'sale'
--   and note like 'Paid confirmation stock consumption for order %'
-- group by regexp_match(note, 'order ([0-9]+)'), portion_type_id
-- having count(*) > 1;
--
-- Finished-stock sale audit trail tied to paid order confirmation:
-- select id, portion_type_id, quantity_delta, resulting_quantity, note, created_at
-- from public.finished_stock_movements
-- where movement_type = 'sale'
--   and note like 'Paid confirmation stock consumption for order %'
-- order by created_at desc;

commit;
