begin;

-- Phase 27: paid-order stock reservation review state.
-- Purpose:
-- 1. Preserve payment settlement even if stock reservation races or fails.
-- 2. Flag paid orders for admin review when automatic reservation cannot complete.
-- 3. Block fulfillment movement until staff resolve paid orders without reserved stock.

alter table public.orders
  add column if not exists stock_reservation_status text,
  add column if not exists stock_reservation_error text,
  add column if not exists stock_reservation_attempted_at timestamptz,
  add column if not exists fulfillment_review_required boolean,
  add column if not exists fulfillment_review_reason text;

update public.orders
set
  stock_reservation_status = coalesce(
    nullif(btrim(coalesce(stock_reservation_status, '')), ''),
    case when stock_reserved_at is not null then 'reserved' else 'not_started' end
  ),
  fulfillment_review_required = coalesce(fulfillment_review_required, false)
where stock_reservation_status is null
   or nullif(btrim(coalesce(stock_reservation_status, '')), '') is null
   or fulfillment_review_required is null;

alter table public.orders
  alter column stock_reservation_status set default 'not_started',
  alter column stock_reservation_status set not null,
  alter column fulfillment_review_required set default false,
  alter column fulfillment_review_required set not null;

alter table public.orders
  drop constraint if exists orders_stock_reservation_status_chk;

alter table public.orders
  add constraint orders_stock_reservation_status_chk
  check (stock_reservation_status in ('not_started', 'reserved', 'failed', 'released', 'finalized'));

comment on column public.orders.stock_reservation_status is
  'Reservation lifecycle for paid-order stock handling.';

comment on column public.orders.stock_reservation_error is
  'Latest stock reservation failure message when payment succeeded but stock could not be reserved.';

comment on column public.orders.stock_reservation_attempted_at is
  'Latest time the backend attempted to reserve stock for the paid order.';

comment on column public.orders.fulfillment_review_required is
  'True when payment succeeded but staff must review fulfillment before moving the order forward.';

comment on column public.orders.fulfillment_review_reason is
  'Human-readable reason staff must review the paid order before fulfillment.';

create index if not exists orders_fulfillment_review_required_idx
  on public.orders (fulfillment_review_required, created_at desc)
  where fulfillment_review_required = true;

create index if not exists orders_stock_reservation_status_idx
  on public.orders (stock_reservation_status, created_at desc);

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
    raise exception 'Only paid orders can reserve stock';
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
    into v_existing_daily_stock
    from public.daily_stock
    where stock_date = v_order.service_date
      and portion_type_id = v_item.portion_type_id
    for update;

    if found then
      if v_existing_daily_stock.remaining_quantity < v_item.quantity_required then
        raise exception 'Insufficient stock for portion % on %', v_item.portion_type_id, v_order.service_date;
      end if;

      update public.daily_stock
      set reserved_quantity = reserved_quantity + v_item.quantity_required
      where stock_date = v_order.service_date
        and portion_type_id = v_item.portion_type_id;
    else
      select *
      into v_finished_stock
      from public.finished_stock
      where portion_type_id = v_item.portion_type_id
      for update;

      if not found or v_finished_stock.current_quantity < v_item.quantity_required then
        raise exception 'Insufficient stock for portion % on %', v_item.portion_type_id, v_order.service_date;
      end if;

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
    raise exception 'Order % does not have reserved stock to finalize', p_order_id;
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
  set
    stock_reserved_at = null,
    stock_reservation_status = 'finalized'
  where id = p_order_id
  returning *
  into v_order;

  return v_order;
end;
$$;

create or replace function public.mark_order_as_paid(
  p_order_id bigint,
  p_payment_provider text default 'pesapal',
  p_order_tracking_id text default null,
  p_payment_reference text default null,
  p_payment_redirect_url text default null,
  p_note text default null
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_previous_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reservation_error text;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.payment_status = 'paid' then
    if v_order.status = 'cancelled' then
      v_previous_status := v_order.status;

      update public.orders
      set
        status = 'confirmed',
        cancelled_at = null,
        fulfillment_review_required = false,
        fulfillment_review_reason = null
      where id = p_order_id
      returning *
      into v_order;

      insert into public.order_status_events (
        order_id,
        event_type,
        from_status,
        to_status,
        note
      )
      values (
        p_order_id,
        'status_changed',
        v_previous_status,
        'confirmed',
        coalesce(v_note, 'Payment verified after pending checkout timeout; order restored to paid workflow.')
      );
    end if;

    if v_order.stock_reserved_at is null then
      begin
        perform public.reserve_paid_order_stock(p_order_id);
      exception
        when others then
          v_reservation_error := sqlerrm;

          update public.orders
          set
            stock_reservation_status = 'failed',
            stock_reservation_error = v_reservation_error,
            stock_reservation_attempted_at = now(),
            fulfillment_review_required = true,
            fulfillment_review_reason = 'Payment succeeded, but stock could not be reserved automatically. Review this order before fulfillment.'
          where id = p_order_id;

          insert into public.order_status_events (
            order_id,
            event_type,
            from_status,
            to_status,
            note
          )
          values (
            p_order_id,
            'note_added',
            null,
            null,
            'Stock reservation failed after paid verification: ' || v_reservation_error
          );
      end;

      select *
      into v_order
      from public.orders
      where id = p_order_id;
    end if;

    return v_order;
  end if;

  v_previous_status := v_order.status;

  update public.orders
  set
    payment_status = 'paid',
    payment_provider = coalesce(nullif(btrim(coalesce(p_payment_provider, '')), ''), payment_provider, 'pesapal'),
    order_tracking_id = coalesce(nullif(btrim(coalesce(p_order_tracking_id, '')), ''), order_tracking_id),
    payment_reference = coalesce(nullif(btrim(coalesce(p_payment_reference, '')), ''), payment_reference),
    payment_redirect_url = coalesce(nullif(btrim(coalesce(p_payment_redirect_url, '')), ''), payment_redirect_url),
    payment_last_verified_at = now(),
    paid_at = coalesce(paid_at, now()),
    payment_initiation_failure_code = null,
    payment_initiation_failure_message = null,
    payment_initiation_failed_at = null,
    stock_reservation_status = case when stock_reserved_at is not null then stock_reservation_status else 'not_started' end,
    stock_reservation_error = null,
    fulfillment_review_required = false,
    fulfillment_review_reason = null,
    cancelled_at = case when status = 'cancelled' then null else cancelled_at end,
    status = case when status in ('new', 'cancelled') then 'confirmed' else status end
  where id = p_order_id
  returning *
  into v_order;

  begin
    perform public.reserve_paid_order_stock(p_order_id);
  exception
    when others then
      v_reservation_error := sqlerrm;

      update public.orders
      set
        stock_reservation_status = 'failed',
        stock_reservation_error = v_reservation_error,
        stock_reservation_attempted_at = now(),
        fulfillment_review_required = true,
        fulfillment_review_reason = 'Payment succeeded, but stock could not be reserved automatically. Review this order before fulfillment.'
      where id = p_order_id;

      insert into public.order_status_events (
        order_id,
        event_type,
        from_status,
        to_status,
        note
      )
      values (
        p_order_id,
        'note_added',
        null,
        null,
        'Stock reservation failed after paid verification: ' || v_reservation_error
      );
  end;

  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if v_previous_status <> v_order.status then
    insert into public.order_status_events (
      order_id,
      event_type,
      from_status,
      to_status,
      note
    )
    values (
      v_order.id,
      'status_changed',
      v_previous_status,
      v_order.status,
      coalesce(v_note, 'Payment verified and stock reservation attempted.')
    );
  elsif v_note is not null then
    insert into public.order_status_events (
      order_id,
      event_type,
      from_status,
      to_status,
      note
    )
    values (
      v_order.id,
      'note_added',
      null,
      null,
      v_note
    );
  end if;

  return v_order;
end;
$$;

create or replace function public.transition_order_status(
  p_order_id bigint,
  p_to_status text,
  p_note text default null
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_from_status text;
  v_valid boolean := false;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  v_from_status := v_order.status;

  v_valid := case
    when v_from_status = 'new' and p_to_status = 'cancelled' then true
    when v_from_status = 'confirmed' and p_to_status in ('in_prep', 'cancelled') then true
    when v_from_status = 'in_prep' and p_to_status in ('ready', 'cancelled') then true
    when v_from_status = 'ready' and p_to_status in ('completed', 'cancelled') then true
    else false
  end;

  if not v_valid then
    raise exception 'Invalid order status transition from % to %', v_from_status, p_to_status;
  end if;

  if p_to_status in ('confirmed', 'in_prep', 'ready', 'completed') and v_order.payment_status <> 'paid' then
    raise exception 'Only paid orders can move to %', p_to_status;
  end if;

  if p_to_status in ('in_prep', 'ready', 'completed') and v_order.fulfillment_review_required then
    raise exception 'This paid order requires fulfillment review before moving to %', p_to_status;
  end if;

  if p_to_status in ('in_prep', 'ready', 'completed') and v_order.stock_reserved_at is null then
    raise exception 'This paid order does not have reserved stock yet';
  end if;

  if p_to_status = 'cancelled' and v_order.stock_reserved_at is not null then
    select *
    into v_order
    from public.release_reserved_order_stock(p_order_id);
  end if;

  if p_to_status = 'completed' then
    select *
    into v_order
    from public.finalize_reserved_order_sale(p_order_id);
  end if;

  update public.orders
  set
    status = p_to_status,
    payment_status = case
      when p_to_status = 'cancelled' and payment_status <> 'paid' then 'cancelled'
      else payment_status
    end,
    completed_at = case when p_to_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
    cancelled_at = case when p_to_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
  where id = p_order_id
  returning *
  into v_order;

  insert into public.order_status_events (
    order_id,
    event_type,
    from_status,
    to_status,
    note
  )
  values (
    v_order.id,
    'status_changed',
    v_from_status,
    p_to_status,
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return v_order;
end;
$$;

commit;
