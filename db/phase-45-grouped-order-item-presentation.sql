begin;

-- Phase 45: Storefront grouped-cart presentation metadata.
-- Order rows stay flat for stock/payment logic. These nullable fields only let
-- admin and customer UIs nest accompaniments under the main item that added them.

alter table public.order_items
  add column if not exists cart_group_id text,
  add column if not exists cart_item_role text,
  add column if not exists cart_sort_order integer;

alter table public.order_items
  drop constraint if exists order_items_cart_item_role_chk;

alter table public.order_items
  add constraint order_items_cart_item_role_chk
  check (cart_item_role is null or cart_item_role in ('main', 'addon'));

create index if not exists order_items_cart_group_idx
  on public.order_items (order_id, cart_group_id, cart_sort_order)
  where cart_group_id is not null;

create or replace function public.create_storefront_order(
  p_public_token    text,
  p_pickup_code     text,
  p_device_id       text,
  p_customer_name   text,
  p_customer_phone  text,
  p_notes           text,
  p_service_date    date,
  p_promised_at     timestamptz,
  p_total_amount    integer,
  p_items           jsonb
)
returns table (
  id           bigint,
  order_number text,
  public_token text,
  pickup_code  text
)
language plpgsql
as $$
declare
  v_order_id     bigint;
  v_order_number text;
begin
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
  ) values (
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

  return query
    select v_order_id, v_order_number, p_public_token, p_pickup_code;
end;
$$;

revoke execute
  on function public.create_storefront_order(text, text, text, text, text, text, date, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute
  on function public.create_storefront_order(text, text, text, text, text, text, date, timestamptz, integer, jsonb)
  to service_role;

create or replace function public.create_storefront_order_for_checkout(
  p_idempotency_key text,
  p_request_hash    text,
  p_public_token    text,
  p_pickup_code     text,
  p_device_id       text,
  p_customer_name   text,
  p_customer_phone  text,
  p_notes           text,
  p_service_date    date,
  p_promised_at     timestamptz,
  p_total_amount    integer,
  p_items           jsonb
)
returns table (
  id           bigint,
  order_number text,
  public_token text,
  pickup_code  text
)
language plpgsql
as $$
declare
  v_order_id bigint;
  v_order_number text;
  v_updated_count integer;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required';
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
  ) values (
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

  update public.checkout_reservations
  set
    request_hash = coalesce(request_hash, p_request_hash),
    order_id = v_order_id,
    public_token = p_public_token,
    order_number = v_order_number,
    pickup_code = p_pickup_code,
    last_error = null
  where idempotency_key = p_idempotency_key
    and status = 'processing'
    and order_id is null
    and (request_hash is null or request_hash = p_request_hash);

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception 'checkout_reservation_claim_missing_or_mismatched';
  end if;

  return query
    select v_order_id, v_order_number, p_public_token, p_pickup_code;
end;
$$;

revoke execute
  on function public.create_storefront_order_for_checkout(text, text, text, text, text, text, text, text, date, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute
  on function public.create_storefront_order_for_checkout(text, text, text, text, text, text, text, text, date, timestamptz, integer, jsonb)
  to service_role;

comment on column public.order_items.cart_group_id is
  'Optional storefront cart group id used only for nested order display.';

comment on column public.order_items.cart_item_role is
  'Optional grouped-cart role: main or addon. Stock/payment logic remains based on flat order_items rows.';

comment on column public.order_items.cart_sort_order is
  'Optional display ordering within a grouped storefront cart entry.';

commit;
