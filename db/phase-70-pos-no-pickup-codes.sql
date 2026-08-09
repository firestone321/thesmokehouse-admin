-- Phase 70: walk-in POS orders are paid at the counter and do not use online pickup codes.

begin;

update public.orders
set
  pickup_code = null,
  pickup_code_failed_attempts = 0,
  pickup_code_locked_until = null
where order_source = 'pos';

alter table public.orders
  drop constraint if exists orders_pos_pickup_code_chk;

alter table public.orders
  add constraint orders_pos_pickup_code_chk
  check (order_source <> 'pos' or pickup_code is null);

comment on constraint orders_pos_pickup_code_chk on public.orders is
  'Walk-in POS orders are paid and handed over at the counter, so only storefront orders use pickup codes.';

commit;
