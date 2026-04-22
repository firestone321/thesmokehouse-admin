begin;

-- Phase 21: Pesapal payment tracking and paid-only stock reservation.
-- Purpose:
-- 1. Keep storefront orders in a pending operational state until payment is verified.
-- 2. Reserve daily stock only when a payment settles as paid.
-- 3. Release or finalize reserved stock consistently when orders are cancelled or completed.

alter table public.orders
  add column if not exists service_date date;

update public.orders
set service_date = coalesce(
  timezone('Africa/Kampala', promised_at)::date,
  timezone('Africa/Kampala', created_at)::date
)
where service_date is null;

alter table public.orders
  alter column service_date set not null;

comment on column public.orders.service_date is
  'Uganda service day the order should reserve stock against.';

alter table public.orders
  add column if not exists payment_status text;

update public.orders
set payment_status = case
  when status in ('confirmed', 'in_prep', 'ready', 'completed') then 'paid'
  when status = 'cancelled' then 'cancelled'
  else 'pending'
end
where payment_status is null;

alter table public.orders
  alter column payment_status set default 'pending';

alter table public.orders
  alter column payment_status set not null;

alter table public.orders
  drop constraint if exists orders_payment_status_chk;

alter table public.orders
  add constraint orders_payment_status_chk
  check (payment_status in ('pending', 'paid', 'failed', 'cancelled'));

alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists payment_reference text,
  add column if not exists payment_redirect_url text,
  add column if not exists order_tracking_id text,
  add column if not exists payment_last_verified_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_initiation_failure_code text,
  add column if not exists payment_initiation_failure_message text,
  add column if not exists payment_initiation_failed_at timestamptz,
  add column if not exists stock_reserved_at timestamptz;

comment on column public.orders.payment_status is
  'Payment lifecycle state for storefront settlement and paid-only stock reservation.';

comment on column public.orders.payment_provider is
  'Payment provider currently associated with the order, such as pesapal.';

comment on column public.orders.payment_reference is
  'Provider confirmation/reference code for the settled transaction when available.';

comment on column public.orders.payment_redirect_url is
  'Latest provider-hosted payment page used to resume or complete checkout.';

comment on column public.orders.order_tracking_id is
  'Provider tracking identifier used to verify payment status with Pesapal.';

comment on column public.orders.payment_last_verified_at is
  'Last time the backend verified payment status with the provider.';

comment on column public.orders.paid_at is
  'Timestamp when the order first became paid.';

comment on column public.orders.payment_initiation_failure_code is
  'Provider rejection code captured when payment initiation fails explicitly.';

comment on column public.orders.payment_initiation_failure_message is
  'Human-readable provider rejection or initiation failure message.';

comment on column public.orders.payment_initiation_failed_at is
  'Timestamp when the latest explicit initiation failure was recorded.';

comment on column public.orders.stock_reserved_at is
  'Timestamp when service-day stock was first reserved after verified payment.';

create index if not exists orders_payment_status_created_idx
  on public.orders (payment_status, created_at desc);

create unique index if not exists orders_order_tracking_id_key
  on public.orders (order_tracking_id)
  where order_tracking_id is not null;

create table if not exists public.payment_attempts (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on update cascade on delete cascade,
  provider text not null,
  attempt_number integer not null,
  lifecycle_status text not null default 'initiated',
  payment_status text not null default 'pending',
  provider_reference text,
  redirect_url text,
  provider_status text,
  provider_message text,
  payment_reference text,
  raw_response jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_attempts_attempt_number_chk check (attempt_number > 0),
  constraint payment_attempts_lifecycle_status_chk check (lifecycle_status in ('initiating', 'initiated', 'rejected', 'failed')),
  constraint payment_attempts_payment_status_chk check (payment_status in ('pending', 'paid', 'failed', 'cancelled')),
  constraint payment_attempts_order_attempt_unique unique (order_id, attempt_number)
);

create unique index if not exists payment_attempts_provider_reference_uidx
  on public.payment_attempts (provider, provider_reference)
  where provider_reference is not null;

create index if not exists payment_attempts_order_created_idx
  on public.payment_attempts (order_id, created_at desc);

drop trigger if exists payment_attempts_set_updated_at on public.payment_attempts;
create trigger payment_attempts_set_updated_at
before update on public.payment_attempts
for each row
execute function public.set_updated_at();

alter table public.orders
  add column if not exists active_payment_attempt_id bigint references public.payment_attempts(id) on update cascade on delete set null;

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
  set stock_reserved_at = coalesce(stock_reserved_at, v_now)
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
  set stock_reserved_at = null
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
  set stock_reserved_at = null
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
    if v_order.stock_reserved_at is null then
      perform public.reserve_paid_order_stock(p_order_id);

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
    status = case when status = 'new' then 'confirmed' else status end
  where id = p_order_id
  returning *
  into v_order;

  perform public.reserve_paid_order_stock(p_order_id);

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
      coalesce(v_note, 'Payment verified and stock reserved.')
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
