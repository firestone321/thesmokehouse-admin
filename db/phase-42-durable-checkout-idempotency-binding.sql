begin;

-- Phase 42: Durable checkout idempotency binding.
-- Phase 40 prevented concurrent double taps, but a serverless crash after order
-- creation and before result_json was written could still leave a processing
-- reservation that later expired and allowed a second order. This migration
-- binds the idempotency row to the created order inside the same DB transaction.

alter table public.checkout_reservations
  add column if not exists request_hash text,
  add column if not exists order_id bigint references public.orders(id),
  add column if not exists public_token text,
  add column if not exists order_number text,
  add column if not exists pickup_code text,
  add column if not exists last_error text;

create index if not exists checkout_reservations_order_id_idx
  on public.checkout_reservations (order_id)
  where order_id is not null;

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
    unit_price
  )
  select
    v_order_id,
    (item ->> 'menu_item_id')::bigint,
    item ->> 'menu_item_name',
    (item ->> 'quantity')::integer,
    (item ->> 'unit_price')::integer
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

comment on function public.create_storefront_order_for_checkout(text, text, text, text, text, text, text, text, date, timestamptz, integer, jsonb) is
  'Atomically inserts orders + order_items and binds the checkout_reservations idempotency row to the created order before returning.';

commit;
