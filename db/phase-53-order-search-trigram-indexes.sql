begin;

-- Phase 53: accelerate admin order search over order number, customer name, and customer phone.
create extension if not exists pg_trgm with schema extensions;

create index if not exists orders_order_number_trgm_idx
  on public.orders using gin (order_number gin_trgm_ops)
  where order_number is not null;

create index if not exists orders_customer_name_trgm_idx
  on public.orders using gin (customer_name gin_trgm_ops)
  where customer_name is not null;

create index if not exists orders_customer_phone_trgm_idx
  on public.orders using gin (customer_phone gin_trgm_ops)
  where customer_phone is not null;

commit;
