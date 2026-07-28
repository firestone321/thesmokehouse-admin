-- Phase 59: collapse the storefront checkout hot path without removing safety.
-- Rate limits remain fail-closed, order/items/attempt creation remains atomic,
-- and successful Pesapal initiation is durably finalized with recovery and
-- checkout-reservation state in one transaction.

begin;

create or replace function public.consume_storefront_checkout_rate_limits(
  p_route_key text,
  p_route_max integer,
  p_phone_key text,
  p_phone_max integer,
  p_window_seconds integer
)
returns table (
  route_allowed boolean,
  route_remaining integer,
  route_retry_after_seconds integer,
  phone_allowed boolean,
  phone_remaining integer,
  phone_retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route record;
  v_phone record;
begin
  if nullif(btrim(coalesce(p_route_key, '')), '') is null
    or nullif(btrim(coalesce(p_phone_key, '')), '') is null then
    raise exception 'rate_limit_key_required';
  end if;

  if p_route_max <= 0 or p_phone_max <= 0 or p_window_seconds <= 0 then
    raise exception 'invalid_rate_limit_configuration';
  end if;

  select *
  into v_route
  from public.consume_rate_limit(
    p_route_key,
    p_route_max,
    p_window_seconds
  );

  if not coalesce(v_route.allowed, false) then
    return query
      select
        false,
        coalesce(v_route.remaining, 0),
        coalesce(v_route.retry_after_seconds, 1),
        true,
        p_phone_max,
        1;
    return;
  end if;

  select *
  into v_phone
  from public.consume_rate_limit(
    p_phone_key,
    p_phone_max,
    p_window_seconds
  );

  return query
    select
      coalesce(v_route.allowed, false),
      coalesce(v_route.remaining, 0),
      coalesce(v_route.retry_after_seconds, 1),
      coalesce(v_phone.allowed, false),
      coalesce(v_phone.remaining, 0),
      coalesce(v_phone.retry_after_seconds, 1);
end;
$$;

revoke all
  on function public.consume_storefront_checkout_rate_limits(text, integer, text, integer, integer)
  from public, anon, authenticated;
grant execute
  on function public.consume_storefront_checkout_rate_limits(text, integer, text, integer, integer)
  to service_role;

create or replace function public.prepare_storefront_checkout_payment(
  p_idempotency_key text,
  p_request_hash text,
  p_public_token text,
  p_pickup_code text,
  p_device_id text,
  p_customer_name text,
  p_customer_phone text,
  p_notes text,
  p_service_date date,
  p_promised_at timestamptz,
  p_total_amount integer,
  p_items jsonb
)
returns table (
  id bigint,
  order_number text,
  public_token text,
  pickup_code text,
  customer_name text,
  customer_phone text,
  total_amount integer,
  payment_attempt_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id bigint;
  v_order_number text;
  v_attempt_id bigint;
  v_claimed_count integer;
  v_item_count integer;
  v_calculated_total bigint;
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if nullif(btrim(coalesce(p_public_token, '')), '') is null
    or nullif(btrim(coalesce(p_pickup_code, '')), '') is null
    or nullif(btrim(coalesce(p_device_id, '')), '') is null then
    raise exception 'checkout_identity_required';
  end if;

  if v_idempotency_key is not null
    and nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'checkout_request_hash_required';
  end if;

  if p_total_amount <= 0 or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_checkout_payload';
  end if;

  select
    count(*)::integer,
    coalesce(sum(
      (item ->> 'quantity')::integer
      * (item ->> 'unit_price')::integer
    ), 0)::bigint
  into v_item_count, v_calculated_total
  from jsonb_array_elements(p_items) as item;

  if v_item_count < 1 or v_item_count > 50
    or v_calculated_total <> p_total_amount then
    raise exception 'invalid_checkout_total_or_items';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where (item ->> 'quantity')::integer < 1
      or (item ->> 'quantity')::integer > 20
      or (item ->> 'unit_price')::integer < 0
      or nullif(btrim(coalesce(item ->> 'menu_item_name', '')), '') is null
  ) then
    raise exception 'invalid_checkout_item';
  end if;

  if v_idempotency_key is not null then
    insert into public.checkout_reservations (
      idempotency_key,
      request_hash
    )
    values (
      v_idempotency_key,
      p_request_hash
    )
    on conflict (idempotency_key) do nothing;

    get diagnostics v_claimed_count = row_count;

    if v_claimed_count <> 1 then
      raise exception 'checkout_reservation_conflict';
    end if;
  end if;

  insert into public.orders (
    public_token,
    pickup_code,
    device_id,
    customer_name,
    customer_phone,
    notes,
    status,
    payment_status,
    payment_provider,
    service_date,
    promised_at,
    total_amount
  )
  values (
    p_public_token,
    p_pickup_code,
    p_device_id,
    p_customer_name,
    p_customer_phone,
    p_notes,
    'new',
    'pending',
    'pesapal',
    p_service_date,
    p_promised_at,
    p_total_amount
  )
  returning orders.id, orders.order_number
  into v_order_id, v_order_number;

  insert into public.order_items (
    order_id,
    menu_item_id,
    menu_item_name,
    quantity,
    unit_price,
    cart_group_id,
    cart_item_role,
    cart_sort_order
  )
  select
    v_order_id,
    (item ->> 'menu_item_id')::bigint,
    item ->> 'menu_item_name',
    (item ->> 'quantity')::integer,
    (item ->> 'unit_price')::integer,
    nullif(item ->> 'cart_group_id', ''),
    nullif(item ->> 'cart_item_role', ''),
    nullif(item ->> 'cart_sort_order', '')::integer
  from jsonb_array_elements(p_items) as item;

  insert into public.payment_attempts (
    order_id,
    provider,
    attempt_number,
    lifecycle_status,
    payment_status
  )
  values (
    v_order_id,
    'pesapal',
    1,
    'initiating',
    'pending'
  )
  returning payment_attempts.id
  into v_attempt_id;

  update public.orders
  set active_payment_attempt_id = v_attempt_id
  where orders.id = v_order_id;

  if v_idempotency_key is not null then
    update public.checkout_reservations
    set
      request_hash = p_request_hash,
      order_id = v_order_id,
      public_token = p_public_token,
      order_number = v_order_number,
      pickup_code = p_pickup_code,
      last_error = null
    where idempotency_key = v_idempotency_key
      and status = 'processing'
      and order_id is null
      and request_hash = p_request_hash;

    get diagnostics v_claimed_count = row_count;

    if v_claimed_count <> 1 then
      raise exception 'checkout_reservation_binding_failed';
    end if;
  end if;

  return query
    select
      v_order_id,
      v_order_number,
      p_public_token,
      p_pickup_code,
      p_customer_name,
      p_customer_phone,
      p_total_amount,
      v_attempt_id;
end;
$$;

revoke all
  on function public.prepare_storefront_checkout_payment(text, text, text, text, text, text, text, text, date, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute
  on function public.prepare_storefront_checkout_payment(text, text, text, text, text, text, text, text, date, timestamptz, integer, jsonb)
  to service_role;

create or replace function public.begin_storefront_payment_attempt(
  p_public_token text
)
returns table (
  id bigint,
  order_number text,
  public_token text,
  pickup_code text,
  customer_name text,
  customer_phone text,
  total_amount integer,
  payment_attempt_id bigint,
  payment_status text,
  payment_redirect_url text,
  reused boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_attempt_id bigint;
  v_attempt_number integer;
begin
  select o.*
  into v_order
  from public.orders as o
  where o.public_token = p_public_token
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  if lower(coalesce(v_order.payment_status, 'pending')) in ('paid', 'completed') then
    raise exception 'order_already_paid';
  end if;

  if lower(coalesce(v_order.payment_status, 'pending')) in ('cancelled', 'canceled') then
    raise exception 'order_payment_cancelled';
  end if;

  if v_order.order_tracking_id is not null
    and v_order.payment_redirect_url is not null then
    perform public.enqueue_pending_payment_recovery(
      v_order.id,
      v_order.order_tracking_id,
      'pesapal',
      'Existing tracked pending payment reused for checkout.'
    );

    update public.checkout_reservations
    set
      status = 'complete',
      result_json = jsonb_build_object(
        'public_token', v_order.public_token,
        'order_number', v_order.order_number,
        'pickup_code', v_order.pickup_code,
        'payment_status', 'pending',
        'redirect_url', v_order.payment_redirect_url
      ),
      last_error = null
    where order_id = v_order.id;

    return query
      select
        v_order.id,
        v_order.order_number,
        v_order.public_token,
        v_order.pickup_code,
        v_order.customer_name,
        v_order.customer_phone,
        v_order.total_amount,
        v_order.active_payment_attempt_id,
        'pending'::text,
        v_order.payment_redirect_url,
        true;
    return;
  end if;

  select coalesce(max(pa.attempt_number), 0) + 1
  into v_attempt_number
  from public.payment_attempts as pa
  where pa.order_id = v_order.id;

  insert into public.payment_attempts (
    order_id,
    provider,
    attempt_number,
    lifecycle_status,
    payment_status
  )
  values (
    v_order.id,
    'pesapal',
    v_attempt_number,
    'initiating',
    'pending'
  )
  returning payment_attempts.id
  into v_attempt_id;

  update public.orders
  set active_payment_attempt_id = v_attempt_id
  where orders.id = v_order.id;

  return query
    select
      v_order.id,
      v_order.order_number,
      v_order.public_token,
      v_order.pickup_code,
      v_order.customer_name,
      v_order.customer_phone,
      v_order.total_amount,
      v_attempt_id,
      'pending'::text,
      null::text,
      false;
end;
$$;

revoke all
  on function public.begin_storefront_payment_attempt(text)
  from public, anon, authenticated;
grant execute
  on function public.begin_storefront_payment_attempt(text)
  to service_role;

create or replace function public.finalize_storefront_payment_initiation(
  p_public_token text,
  p_payment_attempt_id bigint,
  p_provider_reference text,
  p_redirect_url text,
  p_provider_status text,
  p_provider_message text,
  p_raw_response jsonb
)
returns table (
  payment_status text,
  payment_redirect_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_updated_count integer;
begin
  if nullif(btrim(coalesce(p_provider_reference, '')), '') is null
    or nullif(btrim(coalesce(p_redirect_url, '')), '') is null then
    raise exception 'pesapal_redirect_details_required';
  end if;

  select o.*
  into v_order
  from public.orders as o
  where o.public_token = p_public_token
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  if v_order.active_payment_attempt_id is distinct from p_payment_attempt_id then
    raise exception 'payment_attempt_is_not_active';
  end if;

  update public.payment_attempts
  set
    lifecycle_status = 'initiated',
    payment_status = 'pending',
    provider_reference = p_provider_reference,
    redirect_url = p_redirect_url,
    provider_status = p_provider_status,
    provider_message = p_provider_message,
    raw_response = coalesce(p_raw_response, '{}'::jsonb)
  where id = p_payment_attempt_id
    and order_id = v_order.id
    and provider = 'pesapal';

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception 'payment_attempt_not_found';
  end if;

  update public.orders
  set
    payment_status = 'pending',
    payment_provider = 'pesapal',
    order_tracking_id = p_provider_reference,
    payment_redirect_url = p_redirect_url,
    payment_initiation_failure_code = null,
    payment_initiation_failure_message = null,
    payment_initiation_failed_at = null,
    active_payment_attempt_id = p_payment_attempt_id
  where id = v_order.id;

  perform public.enqueue_pending_payment_recovery(
    v_order.id,
    p_provider_reference,
    'pesapal',
    'Pesapal payment initiation created a tracked pending payment.'
  );

  update public.checkout_reservations
  set
    status = 'complete',
    result_json = jsonb_build_object(
      'public_token', v_order.public_token,
      'order_number', v_order.order_number,
      'pickup_code', v_order.pickup_code,
      'payment_status', 'pending',
      'redirect_url', p_redirect_url
    ),
    last_error = null
  where order_id = v_order.id;

  return query
    select 'pending'::text, p_redirect_url;
end;
$$;

revoke all
  on function public.finalize_storefront_payment_initiation(text, bigint, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute
  on function public.finalize_storefront_payment_initiation(text, bigint, text, text, text, text, jsonb)
  to service_role;

comment on function public.consume_storefront_checkout_rate_limits(text, integer, text, integer, integer) is
  'Consumes the route and phone checkout limits in one server round trip while preserving route-first fail-closed behavior.';

comment on function public.prepare_storefront_checkout_payment(text, text, text, text, text, text, text, text, date, timestamptz, integer, jsonb) is
  'Atomically claims checkout idempotency when present, creates the order and grouped items, and starts one durable Pesapal payment attempt.';

comment on function public.begin_storefront_payment_attempt(text) is
  'Atomically loads an existing order and either reuses its tracked redirect or starts one new durable Pesapal attempt.';

comment on function public.finalize_storefront_payment_initiation(text, bigint, text, text, text, text, jsonb) is
  'Atomically finalizes one Pesapal attempt, updates the order, enqueues durable recovery, and completes its checkout reservation.';

commit;
