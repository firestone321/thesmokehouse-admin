begin;

-- Phase 40: Checkout idempotency.
-- Prevents duplicate orders from double-taps and network retries.
-- The storefront generates a UUID per checkout session and sends it as
-- idempotency_key. The server claims a reservation row before any writes;
-- repeat submissions with the same key return the cached result.

create table if not exists public.checkout_reservations (
  idempotency_key  text        primary key,
  status           text        not null default 'processing'
                               check (status in ('processing', 'complete', 'failed')),
  result_json      jsonb,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default (now() + interval '5 minutes'),
  constraint checkout_reservations_expires_at_chk
    check (expires_at <= created_at + interval '7 minutes')
);

create index if not exists checkout_reservations_expires_at_idx
  on public.checkout_reservations (expires_at);

alter table public.checkout_reservations enable row level security;

revoke all on public.checkout_reservations from anon, authenticated;
grant all on public.checkout_reservations to service_role;

-- Atomically creates an order and its items in one transaction.
-- A failed order_items insert rolls back the order row automatically;
-- no cleanup delete needed in the caller.
-- Raises on public_token uniqueness conflict (23505) so the caller
-- can retry with a freshly generated token.

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
    unit_price
  )
  select
    v_order_id,
    (item ->> 'menu_item_id')::bigint,
    item ->> 'menu_item_name',
    (item ->> 'quantity')::integer,
    (item ->> 'unit_price')::integer
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

comment on table public.checkout_reservations is
  'Short-lived idempotency reservation per checkout attempt. Default expiry 5 minutes; maximum 7 minutes enforced by constraint.';

comment on function public.create_storefront_order(text, text, text, text, text, text, date, timestamptz, integer, jsonb) is
  'Atomically inserts orders + order_items in one transaction. Raises 23505 on public_token conflict so the caller can retry with a fresh token.';

commit;
