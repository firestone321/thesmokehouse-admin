begin;

-- Phase 99: ordinary POS sales of traveller foods use the same stock path
-- as other products. Count available accompaniments after main stock is held.
do $$
begin
  if to_regprocedure('public.record_traveller_accompaniments(bigint)') is null
     or to_regclass('public.traveller_order_accompaniments') is null then
    raise exception 'apply_phase_98_before_phase_99';
  end if;
end;
$$;

create or replace function public.count_traveller_accompaniments_on_pos_sale()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1
    from public.order_items order_item
    join public.menu_items item on item.id = order_item.menu_item_id
    where order_item.order_id = new.id
      and item.code in ('traveller_chicken_meal','traveller_goat_meal',
        'traveller_beef_kebabs','traveller_beef_samosas')
  ) then
    perform public.record_traveller_accompaniments(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.count_traveller_accompaniments_on_pos_sale()
from public, anon, authenticated;

drop trigger if exists traveller_accompaniments_on_standard_pos_sale on public.orders;
create trigger traveller_accompaniments_on_standard_pos_sale
  after update of stock_reserved_at on public.orders
  for each row
  when (
    old.stock_reserved_at is null
    and new.stock_reserved_at is not null
    and new.order_source = 'pos'
    and new.status = 'confirmed'
    and new.payment_status = 'paid'
  )
  execute function public.count_traveller_accompaniments_on_pos_sale();

commit;
