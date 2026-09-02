begin;

-- Phase 84: Phase 74's returned `id` column is a PL/pgSQL output variable.
-- Qualify the orders table references so signed-in checkout does not confuse
-- that output variable with public.orders.id.
create or replace function public.prepare_storefront_checkout_payment_for_customer(
  p_customer_id     uuid,
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
  v_result record;
  v_existing_customer_id uuid;
begin
  if p_customer_id is null
    or not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'storefront_customer_required';
  end if;

  for v_result in
    select *
    from public.prepare_storefront_checkout_payment(
      p_idempotency_key,
      p_request_hash,
      p_public_token,
      p_pickup_code,
      p_device_id,
      p_customer_name,
      p_customer_phone,
      p_notes,
      p_service_date,
      p_promised_at,
      p_total_amount,
      p_items
    )
  loop
    select o.customer_id
    into v_existing_customer_id
    from public.orders as o
    where o.id = v_result.id
    for update;

    if v_existing_customer_id is not null
      and v_existing_customer_id <> p_customer_id then
      raise exception 'checkout_customer_mismatch';
    end if;

    update public.orders as o
    set customer_id = p_customer_id
    where o.id = v_result.id
      and o.customer_id is null;

    return query
      select
        v_result.id,
        v_result.order_number,
        v_result.public_token,
        v_result.pickup_code,
        v_result.customer_name,
        v_result.customer_phone,
        v_result.total_amount,
        v_result.payment_attempt_id;
  end loop;
end;
$$;

revoke all
  on function public.prepare_storefront_checkout_payment_for_customer(uuid, text, text, text, text, text, text, text, text, date, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute
  on function public.prepare_storefront_checkout_payment_for_customer(uuid, text, text, text, text, text, text, text, text, date, timestamptz, integer, jsonb)
  to service_role;

comment on function public.prepare_storefront_checkout_payment_for_customer(uuid, text, text, text, text, text, text, text, text, date, timestamptz, integer, jsonb) is
  'Creates a storefront checkout through the existing payment path and associates it with the authenticated customer account.';

commit;
