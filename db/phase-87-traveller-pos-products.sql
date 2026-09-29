begin;

-- Phase 87: private POS traveller products and stock requirements.
-- Products stay inactive until their restock outputs are configured.
alter table public.menu_items add column if not exists pos_only boolean not null default false;
comment on column public.menu_items.pos_only is 'Visible to staff POS only; never eligible for storefront checkout.';

create or replace function public.get_sales_channel_menu(p_service_date date, p_include_pos_only boolean)
returns table (
  id bigint, name text, description text, base_price integer, image_url text,
  prep_type text, portion_label text, category_code text, category_name text,
  is_active boolean, is_available_today boolean, availability_days smallint[],
  availability_start_date date, availability_end_date date, available_quantity integer
)
language sql stable set search_path = public
as $$
  select
    mi.id, mi.name, mi.description, mi.base_price, mi.image_url, mi.prep_type,
    pt.portion_label, mc.code, mc.name, mi.is_active, mi.is_available_today,
    mi.availability_days, mi.availability_start_date, mi.availability_end_date,
    case
      when req.requirement_count > 0 then coalesce(req.available_quantity, 0)
      when pt.id is null then 0
      when pt.stock_source_portion_type_id is not null then floor(
        coalesce(src_ds.remaining_quantity, src_fs.current_quantity, 0)::numeric
        / greatest(pt.stock_source_units_per_serving, 1)
      )::integer
      else coalesce(ds.remaining_quantity, fs.current_quantity, 0)
    end
  from public.menu_items mi
  join public.menu_categories mc on mc.id = mi.menu_category_id
  left join public.portion_types pt on pt.id = mi.portion_type_id
  left join public.daily_stock ds on ds.portion_type_id = pt.id and ds.stock_date = p_service_date
  left join public.finished_stock fs on fs.portion_type_id = pt.id
  left join public.daily_stock src_ds on src_ds.portion_type_id = pt.stock_source_portion_type_id and src_ds.stock_date = p_service_date
  left join public.finished_stock src_fs on src_fs.portion_type_id = pt.stock_source_portion_type_id
  left join lateral (
    select count(*)::integer as requirement_count,
      min(floor(coalesce(rds.remaining_quantity, rfs.current_quantity, 0)::numeric
        / requirement.units_per_menu_item))::integer as available_quantity
    from public.menu_item_stock_requirements requirement
    left join public.daily_stock rds
      on rds.portion_type_id = requirement.portion_type_id and rds.stock_date = p_service_date
    left join public.finished_stock rfs on rfs.portion_type_id = requirement.portion_type_id
    where requirement.menu_item_id = mi.id
  ) req on true
  where mi.is_active = true and mi.is_available_today = true
    and (p_include_pos_only or not mi.pos_only)
  order by mi.sort_order, mi.name;
$$;

create or replace function public.get_storefront_menu(p_service_date date)
returns table (
  id bigint, name text, description text, base_price integer, image_url text,
  prep_type text, portion_label text, category_code text, category_name text,
  is_active boolean, is_available_today boolean, availability_days smallint[],
  availability_start_date date, availability_end_date date, available_quantity integer
)
language sql stable set search_path = public
as $$ select * from public.get_sales_channel_menu(p_service_date, false); $$;

create or replace function public.get_pos_menu(p_service_date date)
returns table (
  id bigint, name text, description text, base_price integer, image_url text,
  prep_type text, portion_label text, category_code text, category_name text,
  is_active boolean, is_available_today boolean, availability_days smallint[],
  availability_start_date date, availability_end_date date, available_quantity integer
)
language sql stable set search_path = public
as $$ select * from public.get_sales_channel_menu(p_service_date, true); $$;

revoke all on function public.get_sales_channel_menu(date, boolean) from public, anon, authenticated;
revoke all on function public.get_storefront_menu(date) from public, anon, authenticated;
revoke all on function public.get_pos_menu(date) from public, anon, authenticated;
grant execute on function public.get_sales_channel_menu(date, boolean) to service_role;
grant execute on function public.get_storefront_menu(date) to service_role;
grant execute on function public.get_pos_menu(date) to service_role;

insert into public.menu_categories(code, name, sort_order, is_active)
values ('travellers', 'Travellers', 9, true)
on conflict (code) do update set name = excluded.name, is_active = true;

insert into public.portion_types(code, name, portion_label, sort_order, is_active)
values
 ('traveller_chicken_meal', 'Traveller chicken meal', '1 meal', 80, true),
 ('traveller_goat_250g', 'Traveller goat chunks', '250g', 81, true),
 ('traveller_goat_meal', 'Traveller goat meal', '1 meal', 82, true),
 ('traveller_beef_skewer', 'Traveller beef skewer', '1 skewer', 83, true),
 ('traveller_kebabs_pair', 'Traveller beef kebabs', '2 skewers', 84, true),
 ('traveller_beef_samosa_piece', 'Traveller beef samosa', '1 piece', 85, true),
 ('traveller_samosas_three', 'Traveller beef samosas', '3 pieces', 86, true),
 ('fries_stock_25g', 'Shared fries stock', '25g', 87, true),
 ('traveller_fries', 'Traveller fries', '200g', 88, true),
 ('traveller_salad', 'Traveller fresh salad', '1 serving', 88, true),
 ('traveller_sauce', 'Traveller dipping sauce', '1 serving', 89, true),
 ('soda_bottle_330ml', 'Shared soda bottle', '330ml', 92, true)
on conflict (code) do nothing;

update public.portion_types
set stock_source_portion_type_id = (select id from public.portion_types where code = 'fries_stock_25g'),
    stock_source_units_per_serving = 8
where code = 'traveller_fries';

with seed(code, name, description, price, prep_type, portion_code, sort_order) as (
 values
 ('traveller_chicken_meal', 'Traveller Smoked Chicken', 'Quarter smoked chicken, traveller fries, fresh salad and Firestone sauce.', 24500, 'smoked', 'traveller_chicken_meal', 1),
 ('traveller_goat_meal', 'Traveller Smoked Goat', '250g smoked goat chunks, traveller fries, fresh salad and Firestone sauce.', 29500, 'smoked', 'traveller_goat_meal', 2),
 ('traveller_beef_kebabs', 'Traveller Beef Kebabs', 'Two smoked beef skewers with dipping sauce.', 7000, 'packed', 'traveller_kebabs_pair', 3),
 ('traveller_beef_samosas', 'Traveller Beef Samosas', 'Three smoked-beef samosas with dipping sauce.', 7000, 'packed', 'traveller_samosas_three', 4)
)
insert into public.menu_items(code, menu_category_id, portion_type_id, name, description,
  base_price, prep_type, is_active, is_available_today, sort_order, pos_only)
select seed.code, mc.id, pt.id, seed.name, seed.description, seed.price, seed.prep_type,
  false, false, seed.sort_order, true
from seed
join public.menu_categories mc on mc.code = 'travellers'
join public.portion_types pt on pt.code = seed.portion_code
on conflict (code) do nothing;

-- An earlier inactive seed already created duplicate traveller drink choices.
-- They have never been sold; fail closed if an environment has order history.
do $$
begin
  if exists (select 1 from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id
    where mi.code in ('traveller_orange_juice','traveller_water','traveller_soda')) then
    raise exception 'cannot_remove_sold_traveller_drink_rows';
  end if;
end;
$$;
delete from public.menu_items
where code in ('traveller_orange_juice','traveller_water','traveller_soda');

update public.menu_items set pos_only = true
where code in ('traveller_chicken_meal','traveller_goat_meal',
  'traveller_beef_kebabs','traveller_beef_samosas');

-- The ordinary Soda product uses the existing raw Soda carton intake. Staff
-- count actual bottles into one shared sellable pool during restocking; the
-- generic drink trigger must not create a second automatic intake mapping.
create or replace function public.sync_menu_drink_intake_item()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.code <> 'soda' then
    perform public.ensure_menu_drink_intake_item(new.id);
  end if;
  return new;
end;
$$;
insert into public.menu_items
  (code,menu_category_id,portion_type_id,name,description,base_price,
   prep_type,is_active,is_available_today,sort_order,pos_only)
select 'soda',mc.id,pt.id,'Soda','330ml soda bottle or can.',2000,
  'drink',false,false,20,false
from public.menu_categories mc
join public.portion_types pt on pt.code='soda_bottle_330ml'
where mc.code='drinks'
on conflict (code) do nothing;
delete from public.menu_item_stock_requirements requirement
using public.menu_items item, public.portion_types portion
where requirement.menu_item_id = item.id
  and requirement.portion_type_id = portion.id
  and item.code in ('traveller_chicken_meal', 'traveller_goat_meal')
  and portion.code = 'traveller_fries';
with required(menu_code, portion_code, units) as (
 values
 ('traveller_chicken_meal', 'chicken_quarter', 1),
 ('traveller_chicken_meal', 'fries_stock_25g', 8),
 ('traveller_chicken_meal', 'traveller_salad', 1),
 ('traveller_chicken_meal', 'traveller_sauce', 1),
 ('traveller_goat_meal', 'traveller_goat_250g', 1),
 ('traveller_goat_meal', 'fries_stock_25g', 8),
 ('traveller_goat_meal', 'traveller_salad', 1),
 ('traveller_goat_meal', 'traveller_sauce', 1),
 ('traveller_beef_kebabs', 'traveller_beef_skewer', 2),
 ('traveller_beef_kebabs', 'traveller_sauce', 1),
 ('traveller_beef_samosas', 'traveller_beef_samosa_piece', 3),
 ('traveller_beef_samosas', 'traveller_sauce', 1)
)
insert into public.menu_item_stock_requirements(menu_item_id, portion_type_id, units_per_menu_item)
select mi.id, pt.id, required.units
from required
join public.menu_items mi on mi.code = required.menu_code
join public.portion_types pt on pt.code = required.portion_code
on conflict (menu_item_id, portion_type_id) do update
set units_per_menu_item = excluded.units_per_menu_item;

do $$
begin
  if (select count(*) from public.menu_item_stock_requirements r
      join public.menu_items mi on mi.id = r.menu_item_id
      where mi.code in ('traveller_chicken_meal','traveller_goat_meal','traveller_beef_kebabs','traveller_beef_samosas')) <> 12 then
    raise exception 'Incomplete traveller meal stock requirements';
  end if;
  if (select count(*) from public.menu_items where pos_only and menu_category_id =
      (select id from public.menu_categories where code = 'travellers')) <> 4 then
    raise exception 'Traveller POS products were not seeded completely';
  end if;
end;
$$;

commit;
