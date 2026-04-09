begin;

-- Phase 10: storefront shared-order support.
-- Purpose:
-- 1. Let the client storefront write into the same operational orders table as admin.
-- 2. Add public tracking fields used by the customer-facing order flow.
-- 3. Generate order numbers in the database so both apps share one sequence.

create sequence if not exists public.order_number_seq
  start with 1000
  increment by 1
  minvalue 1000;

create or replace function public.generate_order_number()
returns text
language plpgsql
as $$
declare
  v_next bigint;
begin
  v_next := nextval('public.order_number_seq');
  return v_next::text;
end;
$$;

with existing_numbers as (
  select max(order_number::bigint) as max_order_number
  from public.orders
  where order_number ~ '^[0-9]+$'
)
select setval(
  'public.order_number_seq',
  coalesce((select max_order_number from existing_numbers), 1000),
  coalesce((select max_order_number is not null from existing_numbers), false)
);

alter table public.orders
  alter column order_number set default public.generate_order_number();

alter table public.orders
  add column if not exists public_token text;

alter table public.orders
  add column if not exists pickup_code text;

comment on column public.orders.public_token is
  'Customer-facing tracking token used by the storefront order status page.';

comment on column public.orders.pickup_code is
  'Short pickup handoff code shown to the customer after checkout.';

create unique index if not exists orders_public_token_key
  on public.orders (public_token)
  where public_token is not null;

alter table public.orders
  drop constraint if exists orders_pickup_code_format_chk;

alter table public.orders
  add constraint orders_pickup_code_format_chk
  check (pickup_code is null or pickup_code ~ '^[0-9]{4}$');

commit;
