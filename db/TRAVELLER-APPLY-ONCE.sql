begin;

-- phase-87-traveller-pos-products.sql
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

-- phase-88-traveller-goat-allocation.sql
-- Goat chunks can be committed to standalone, Country Platter, and 250 g
-- traveller packs from one cooked receipt. The existing allocator handles the
-- first two pools; this wrapper credits the third in the same transaction.
update public.portion_types traveller
set protein_id = standard.protein_id,
    packaging_type_id = standard.packaging_type_id
from public.portion_types standard
where traveller.code = 'traveller_goat_250g' and standard.code = 'goat_chunks_portions';

insert into public.protein_intake_item_portions(protein_intake_item_id, portion_type_id, is_default)
select intake.id, traveller.id, false
from public.protein_intake_items intake
join public.portion_types traveller on traveller.code = 'traveller_goat_250g'
where intake.code = 'goat_chunks'
on conflict (protein_intake_item_id, portion_type_id) do update set is_default = false;

create or replace function public.process_traveller_goat_receipt_allocation(
  p_procurement_receipt_id bigint,
  p_post_roast_packed_weight_kg numeric(10,3),
  p_country_platter_weight_kg numeric(10,3),
  p_traveller_weight_kg numeric(10,3),
  p_note text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_traveller public.portion_types%rowtype;
  v_regular public.portion_types%rowtype;
  v_platter public.portion_types%rowtype;
  v_stock public.finished_stock%rowtype;
  v_batch public.processing_batches%rowtype;
  v_other_weight numeric(10,3);
  v_other_full integer;
  v_traveller_count integer;
  v_trim numeric(10,3);
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  select * into v_receipt from public.procurement_receipts
  where id = p_procurement_receipt_id for update;
  if not found or v_receipt.protein_code <> 'goat_chunks' then
    raise exception 'goat_chunks_receipt_required';
  end if;
  if exists (select 1 from public.processing_batches where procurement_receipt_id = p_procurement_receipt_id) then
    raise exception 'receipt_already_processed';
  end if;
  if p_post_roast_packed_weight_kg is null or p_post_roast_packed_weight_kg <= 0
     or p_post_roast_packed_weight_kg > v_receipt.quantity_received
     or p_country_platter_weight_kg is null or p_country_platter_weight_kg < 0
     or p_traveller_weight_kg is null or p_traveller_weight_kg < 0
     or p_country_platter_weight_kg + p_traveller_weight_kg > p_post_roast_packed_weight_kg then
    raise exception 'invalid_goat_allocation_weights';
  end if;
  select * into v_traveller from public.portion_types
  where code = 'traveller_goat_250g' and portion_label = '250g' and is_active;
  if not found then raise exception 'traveller_goat_portion_not_configured'; end if;

  select * into v_regular from public.portion_types where code = 'goat_chunks_portions';
  select * into v_platter from public.portion_types where code = 'country_platter_goat_chops';
  if v_regular.portion_label <> '400g' or v_platter.portion_label <> '300g' then
    raise exception 'goat_portion_sizes_changed';
  end if;  if p_traveller_weight_kg > 0 and p_traveller_weight_kg < 0.250 then
    raise exception 'traveller_goat_weight_below_one_portion';
  end if;
  v_other_weight := p_post_roast_packed_weight_kg - p_traveller_weight_kg;
  v_other_full := floor(p_country_platter_weight_kg / 0.300)::integer
    + floor((v_other_weight - p_country_platter_weight_kg) / 0.400)::integer;
  v_traveller_count := floor(p_traveller_weight_kg / 0.250)::integer;
  if v_other_full + v_traveller_count = 0 then raise exception 'no_full_goat_portions'; end if;

  if v_other_full > 0 then
    perform public.process_standard_weight_meat_receipt_allocation(
      p_procurement_receipt_id, v_other_weight, p_country_platter_weight_kg, p_note);
  end if;
  if v_traveller_count > 0 then
    v_trim := p_traveller_weight_kg - v_traveller_count * 0.250;
    if v_other_full = 0 then v_trim := v_trim + v_other_weight; end if;
    insert into public.processing_batches
      (procurement_receipt_id, portion_type_id, quantity_produced,
       post_roast_packed_weight_kg, trim_weight_kg, yield_percent, note)
    values (p_procurement_receipt_id, v_traveller.id, v_traveller_count,
      case when v_other_full = 0 then p_post_roast_packed_weight_kg else p_traveller_weight_kg end, v_trim,
      round((case when v_other_full = 0 then p_post_roast_packed_weight_kg else p_traveller_weight_kg end) / v_receipt.quantity_received * 100, 2),
      nullif(btrim(coalesce(p_note, '')), ''))
    returning * into v_batch;
    insert into public.finished_stock(portion_type_id, current_quantity)
    values (v_traveller.id, v_traveller_count)
    on conflict (portion_type_id) do update
    set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
    returning * into v_stock;
    insert into public.finished_stock_movements
      (portion_type_id, movement_type, quantity_delta, resulting_quantity, processing_batch_id, note)
    values (v_traveller.id, 'production', v_traveller_count, v_stock.current_quantity,
      v_batch.id, format('250 g traveller goat allocation from receipt %s', p_procurement_receipt_id));
    insert into public.daily_stock(stock_date, portion_type_id, starting_quantity)
    values (v_today, v_traveller.id, v_stock.current_quantity)
    on conflict (stock_date, portion_type_id) do update
    set starting_quantity = public.daily_stock.starting_quantity + v_traveller_count;
  end if;
end;
$$;

revoke all on function public.process_traveller_goat_receipt_allocation(bigint,numeric,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.process_traveller_goat_receipt_allocation(bigint,numeric,numeric,numeric,text) to service_role;

-- phase-89-shared-fries-25g-units.sql
-- The universal fries pool uses 25 g accounting units, the greatest common
-- divisor of the 225 g regular, 500 g large, and 200 g traveller servings.
-- Existing sellable stock and active daily counters are converted by 9 from
-- the former 225 g source unit. No fries are earmarked during intake.
do $$
declare
  v_regular public.portion_types%rowtype;
  v_base public.portion_types%rowtype;
  v_old_stock public.finished_stock%rowtype;
  v_date_stock public.daily_stock%rowtype;
  v_input public.inventory_items%rowtype;
  v_input_count integer;
  v_new_quantity integer;
begin
  select * into v_base from public.portion_types where code = 'fries_stock_25g' for update;
  if not found or v_base.portion_label <> '25g' then
    raise exception 'shared_fries_base_missing';
  end if;
  select count(*)::integer into v_input_count from public.inventory_items
  where code in ('fries', 'fries_kg') and direct_sellable_portion_type_id is not null;
  if v_input_count <> 1 then raise exception 'expected_one_fries_input_mapping'; end if;
  select ii.* into v_input
  from public.inventory_items ii
  where ii.code in ('fries', 'fries_kg') and ii.direct_sellable_portion_type_id is not null
  for update;
  if not found or lower(v_input.unit_name) <> 'kg' then
    raise exception 'fries_kg_input_mapping_required';
  end if;
  select * into v_regular from public.portion_types
  where id = v_input.direct_sellable_portion_type_id for update;
  if not found or v_regular.portion_label <> '225g' or v_regular.stock_source_portion_type_id is not null then
    raise exception 'expected_225g_regular_fries_source';
  end if;
  -- Ordinary 225 g Fries reservations can be multiplied by nine with their
  -- daily counters. A sourced/compound product may have promised another
  -- weight (notably Large Fries was previously 450 g despite its 500 g label).
  if exists (
    select 1 from public.orders o
    join public.order_items oi on oi.order_id=o.id
    join public.menu_items mi on mi.id=oi.menu_item_id
    join public.portion_types pt on pt.id=mi.portion_type_id
    where o.stock_reservation_status='reserved' and o.stock_reserved_at is not null
      and (pt.stock_source_portion_type_id=v_regular.id
        or exists (select 1 from public.menu_item_stock_requirements requirement
          where requirement.menu_item_id=mi.id
            and requirement.portion_type_id=v_regular.id))
  ) then raise exception 'finish_nonstandard_open_fries_orders_before_unit_conversion'; end if;
  if exists (
    select 1 from public.portion_types pt
    where pt.stock_source_portion_type_id = v_regular.id
      and (substring(pt.portion_label from '^([0-9]+)g$') is null
        or substring(pt.portion_label from '^([0-9]+)g$')::integer % 25 <> 0)
  ) then raise exception 'fries_serving_weight_must_be_multiple_of_25g'; end if;
  if exists (select 1 from public.finished_stock where portion_type_id = v_base.id)
     or exists (select 1 from public.daily_stock where portion_type_id = v_base.id) then
    raise exception 'shared_fries_base_already_initialized';
  end if;

  select * into v_old_stock from public.finished_stock
  where portion_type_id = v_regular.id for update;
  v_new_quantity := coalesce(v_old_stock.current_quantity, 0) * 9;
  insert into public.finished_stock(portion_type_id, current_quantity)
  values (v_base.id, v_new_quantity);
  if v_old_stock.portion_type_id is not null and v_old_stock.current_quantity > 0 then
    update public.finished_stock set current_quantity = 0 where portion_type_id = v_regular.id;
    insert into public.finished_stock_movements
      (portion_type_id, movement_type, quantity_delta, resulting_quantity, note)
    values (v_regular.id, 'adjustment', -v_old_stock.current_quantity, 0,
      'Converted universal fries stock from 225 g units to 25 g units');
    insert into public.finished_stock_movements
      (portion_type_id, movement_type, quantity_delta, resulting_quantity, note)
    values (v_base.id, 'adjustment', v_new_quantity, v_new_quantity,
      'Converted universal fries stock from 225 g units to 25 g units');
  end if;

  for v_date_stock in
    select * from public.daily_stock
    where portion_type_id = v_regular.id
    for update
  loop
    insert into public.daily_stock
      (stock_date, portion_type_id, starting_quantity, reserved_quantity, sold_quantity, waste_quantity)
    values (v_date_stock.stock_date, v_base.id,
      v_date_stock.starting_quantity * 9, v_date_stock.reserved_quantity * 9,
      v_date_stock.sold_quantity * 9, v_date_stock.waste_quantity * 9);
    update public.daily_stock
    set starting_quantity = 0, reserved_quantity = 0, sold_quantity = 0, waste_quantity = 0
    where stock_date = v_date_stock.stock_date and portion_type_id = v_regular.id;
  end loop;

  -- Each sourced fries menu item consumes its labeled gram weight exactly.
  update public.portion_types
  set stock_source_portion_type_id = v_base.id,
      stock_source_units_per_serving = substring(portion_label from '^([0-9]+)g$')::integer / 25
  where stock_source_portion_type_id = v_regular.id;
  update public.portion_types
  set stock_source_portion_type_id = v_base.id,
      stock_source_units_per_serving = 9
  where id = v_regular.id;
  update public.inventory_items
  set direct_sellable_portion_type_id = v_base.id,
      sellable_units_per_input = sellable_units_per_input * 9
  where id = v_input.id;
  if not exists (
    select 1 from public.portion_types
    where code = 'traveller_fries' and portion_label = '200g'
      and stock_source_portion_type_id = v_base.id
      and stock_source_units_per_serving = 8
  ) then raise exception 'traveller_fries_share_not_configured'; end if;
end;
$$;

-- phase-90-traveller-preorder-stock.sql
create table if not exists public.pos_traveller_preorders (
  order_id bigint primary key references public.orders(id) on delete restrict,
  order_mode text not null check (order_mode in ('combined', 'individual')),
  payment_timing text not null check (payment_timing in ('booking', 'arrival')),
  bus_reference text,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  check (bus_reference is null or btrim(bus_reference) <> '')
);
alter table public.pos_traveller_preorders enable row level security;
revoke all on public.pos_traveller_preorders from public, anon, authenticated;
grant all on public.pos_traveller_preorders to service_role;

-- Pending pay-on-arrival preorders hold physical stock at booking. Paid sales
-- retain the existing reservation path and lock order.
create or replace function public.reserve_paid_order_stock(p_order_id bigint)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_existing_daily_stock public.daily_stock%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_now timestamptz := now();
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.payment_status <> 'paid' and not (
    v_order.order_source = 'pos' and v_order.payment_status = 'pending' and exists (
      select 1 from public.pos_traveller_preorders preorder
      where preorder.order_id = p_order_id and preorder.payment_timing = 'arrival'
    )
  ) then raise exception 'Only paid orders or held traveller preorders can reserve stock'; end if;
  if v_order.stock_reserved_at is not null then return v_order; end if;

  if exists (
    select 1 from public.order_items oi join public.menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = p_order_id and mi.portion_type_id is null
  ) then raise exception 'Order % contains a menu item without a sellable portion type', p_order_id; end if;

  for v_item in select * from public.get_order_stock_requirements(p_order_id) loop
    select * into v_finished_stock from public.finished_stock
    where portion_type_id = v_item.portion_type_id for update;
    if not found or v_finished_stock.current_quantity < v_item.quantity_required then
      raise exception 'Insufficient finished stock for portion % on paid order %', v_item.portion_type_id, p_order_id;
    end if;

    select * into v_existing_daily_stock from public.daily_stock
    where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id for update;
    if found then
      -- Future-day rows are snapshots; restocks after the first booking must be
      -- reflected before checking availability. Finished stock is locked and
      -- already excludes every outstanding hold, across all service dates.
      if v_order.service_date > (v_now at time zone 'Africa/Kampala')::date then
        update public.daily_stock
        set starting_quantity = v_finished_stock.current_quantity
          + reserved_quantity + sold_quantity + waste_quantity
        where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id
        returning * into v_existing_daily_stock;
      end if;
      if v_existing_daily_stock.remaining_quantity < v_item.quantity_required then
        raise exception 'Insufficient service-day stock for portion % on %', v_item.portion_type_id, v_order.service_date;
      end if;
      update public.daily_stock set reserved_quantity = reserved_quantity + v_item.quantity_required
      where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id;
    else
      insert into public.daily_stock (stock_date, portion_type_id, starting_quantity, reserved_quantity)
      values (v_order.service_date, v_item.portion_type_id, v_finished_stock.current_quantity, v_item.quantity_required);
    end if;

    update public.finished_stock set current_quantity = current_quantity - v_item.quantity_required
    where portion_type_id = v_item.portion_type_id returning * into v_finished_stock;
    insert into public.finished_stock_movements (
      portion_type_id, movement_type, quantity_delta, resulting_quantity, processing_batch_id, note
    ) values (
      v_item.portion_type_id, 'sale', -v_item.quantity_required, v_finished_stock.current_quantity, null,
      format('Order stock reservation for order %s (%s).', p_order_id, coalesce(v_order.order_number, 'no order number'))
    );
  end loop;

  update public.orders set
    stock_reserved_at = coalesce(stock_reserved_at, v_now), stock_reservation_status = 'reserved',
    stock_reservation_error = null, stock_reservation_attempted_at = v_now,
    fulfillment_review_required = false, fulfillment_review_reason = null
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.release_reserved_order_stock(p_order_id bigint)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_finished_stock public.finished_stock%rowtype;
  v_is_traveller_hold boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.stock_reserved_at is null or v_order.payment_status = 'paid' then return v_order; end if;

  select exists (select 1 from public.pos_traveller_preorders where order_id = p_order_id and payment_timing = 'arrival')
  into v_is_traveller_hold;

  for v_item in select * from public.get_order_stock_requirements(p_order_id) loop
    if v_is_traveller_hold then
      update public.daily_stock
      set reserved_quantity = reserved_quantity - v_item.quantity_required
      where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id
        and reserved_quantity >= v_item.quantity_required;
      if not found then raise exception 'traveller_hold_daily_stock_mismatch'; end if;
      update public.finished_stock
      set current_quantity = current_quantity + v_item.quantity_required
      where portion_type_id = v_item.portion_type_id
      returning * into v_finished_stock;
      if not found then raise exception 'traveller_hold_finished_stock_missing'; end if;
      insert into public.finished_stock_movements
        (portion_type_id, movement_type, quantity_delta, resulting_quantity, note)
      values (v_item.portion_type_id, 'adjustment', v_item.quantity_required,
        v_finished_stock.current_quantity, format('Released unpaid traveller preorder %s', p_order_id));
    else
      update public.daily_stock
      set reserved_quantity = greatest(reserved_quantity - v_item.quantity_required, 0)
      where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id;
    end if;
  end loop;

  update public.orders set stock_reserved_at = null, stock_reservation_status = 'released'
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;
revoke all on function public.reserve_paid_order_stock(bigint) from public, anon, authenticated;
grant execute on function public.reserve_paid_order_stock(bigint) to service_role;
revoke all on function public.release_reserved_order_stock(bigint) from public, anon, authenticated;
grant execute on function public.release_reserved_order_stock(bigint) to service_role;

-- phase-91-traveller-preorder-creation.sql
-- Cashiers can book one combined bus order or separate passenger orders.
-- Both modes use the same exact traveller SKU prices and stock requirements.
create or replace function public.create_pos_traveller_preorder(
  p_idempotency_key uuid,
  p_request_hash text,
  p_cashier_profile_id uuid,
  p_order_mode text,
  p_customer_name text,
  p_customer_phone text,
  p_bus_reference text,
  p_arrival_at timestamptz,
  p_pay_now boolean,
  p_tender_type text,
  p_amount_received integer,
  p_payment_reference text,
  p_items jsonb
)
returns table (
  id bigint, order_number text, status text, payment_status text,
  total_amount integer, tender_type text, amount_received integer,
  change_given integer, promised_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_order public.orders%rowtype;
  v_existing_request public.pos_sale_requests%rowtype;
  v_inserted boolean;
  v_request_count integer;
  v_valid_count integer;
  v_total bigint;
  v_service_date date := (p_arrival_at at time zone 'Africa/Kampala')::date;
  v_tender text := lower(btrim(coalesce(p_tender_type, '')));
  v_reference text := nullif(btrim(coalesce(p_payment_reference, '')), '');
  v_received integer := coalesce(p_amount_received, 0);
begin
  if p_idempotency_key is null or nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'preorder_idempotency_required';
  end if;
  if p_order_mode not in ('combined','individual') then raise exception 'invalid_preorder_mode'; end if;
  if nullif(btrim(coalesce(p_customer_name, '')), '') is null
     or nullif(btrim(coalesce(p_customer_phone, '')), '') is null then
    raise exception 'preorder_customer_contact_required';
  end if;
  if p_order_mode = 'combined' and nullif(btrim(coalesce(p_bus_reference, '')), '') is null then
    raise exception 'combined_preorder_bus_reference_required';
  end if;
  if p_arrival_at is null or p_arrival_at <= now() or p_arrival_at > now() + interval '30 days' then
    raise exception 'preorder_arrival_must_be_within_30_days';
  end if;
  if p_pay_now is null then raise exception 'preorder_payment_timing_required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 7 then
    raise exception 'invalid_preorder_items';
  end if;
  if length(btrim(p_customer_name)) > 120 or length(btrim(p_customer_phone)) > 30
     or length(coalesce(p_bus_reference,'')) > 120 then
    raise exception 'preorder_contact_too_long';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is null or quantity is null or quantity not between 1 and 200
  ) then raise exception 'invalid_preorder_item_quantity'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    group by menu_item_id having sum(quantity) > 200
  ) then raise exception 'preorder_item_quantity_over_limit'; end if;
  select * into v_actor from public.profiles profile where profile.id = p_cashier_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role, 'manager'::public.app_role, 'cashier'::public.app_role, 'staff'::public.app_role) then
    raise exception 'pos_access_denied';
  end if;

  insert into public.pos_sale_requests(idempotency_key, request_hash, cashier_profile_id)
  values (p_idempotency_key, p_request_hash, p_cashier_profile_id)
  on conflict (idempotency_key) do nothing;
  v_inserted := found;
  if not v_inserted then
    select * into v_existing_request from public.pos_sale_requests
    where idempotency_key = p_idempotency_key for update;
    if v_existing_request.request_hash <> p_request_hash
       or v_existing_request.cashier_profile_id <> p_cashier_profile_id then
      raise exception 'pos_idempotency_key_reused_with_different_request';
    end if;
    if v_existing_request.order_id is null then raise exception 'pos_preorder_still_processing'; end if;
    return query select o.id, o.order_number, o.status, o.payment_status,
      o.total_amount, t.tender_type, t.amount_received, t.change_given, o.promised_at
    from public.orders o left join public.pos_tenders t on t.order_id = o.id
    where o.id = v_existing_request.order_id;
    return;
  end if;

  with requested as (
    select menu_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 200
    group by menu_item_id
  ) select count(*)::integer into v_request_count from requested;
  if v_request_count < 1 then raise exception 'invalid_preorder_item_quantity'; end if;
  perform 1 from public.menu_items mi
  join (
    select distinct menu_item_id
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 200
  ) requested on requested.menu_item_id = mi.id
  for update of mi;
  with requested as (
    select menu_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 200
    group by menu_item_id
  ) select count(*)::integer, coalesce(sum(mi.base_price::bigint * requested.quantity),0)::bigint
  into v_valid_count, v_total
  from requested join public.menu_items mi on mi.id = requested.menu_item_id
  join public.menu_categories mc on mc.id = mi.menu_category_id
  where ((mc.code = 'travellers' and mi.pos_only and mi.code in
      ('traveller_chicken_meal','traveller_goat_meal','traveller_beef_kebabs','traveller_beef_samosas'))
    or (mc.code = 'drinks' and not mi.pos_only and mi.code in
      ('juice','bottled_mineral_water','soda')))
    and mi.is_active and mi.is_available_today
    and extract(dow from v_service_date)::smallint = any(mi.availability_days)
    and (mi.availability_start_date is null or v_service_date >= mi.availability_start_date)
    and (mi.availability_end_date is null or v_service_date <= mi.availability_end_date);
  if v_valid_count <> v_request_count or v_total <= 0 or v_total > 2147483647 then
    raise exception 'preorder_item_unavailable_or_invalid';
  end if;
  if not exists (
    select 1 from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    join public.menu_items mi on mi.id = item.menu_item_id
    where mi.code in ('traveller_chicken_meal','traveller_goat_meal',
      'traveller_beef_kebabs','traveller_beef_samosas') and item.quantity > 0
  ) then raise exception 'traveller_food_required'; end if;
  if p_pay_now then
    if v_tender not in ('cash','mobile_money','card') then raise exception 'invalid_pos_tender'; end if;
    if v_tender = 'cash' then
      if v_received < v_total then raise exception 'insufficient_cash_received'; end if;
    elsif v_received <> v_total or v_reference is null then
      raise exception 'non_cash_tender_requires_exact_amount_and_reference';
    end if;
  elsif v_received <> 0 or v_tender <> '' or v_reference is not null then
    raise exception 'pay_on_arrival_cannot_capture_tender_at_booking';
  end if;

  insert into public.orders
    (customer_name, customer_phone, notes, status, payment_status,
     payment_provider, payment_reference, payment_last_verified_at, paid_at,
     service_date, promised_at, total_amount, order_source, cashier_profile_id)
  values
    (btrim(p_customer_name), btrim(p_customer_phone),
     'Traveller preorder' || case when p_bus_reference is null then '' else ' - bus ' || btrim(p_bus_reference) end,
     'new', case when p_pay_now then 'paid' else 'pending' end,
     case when p_pay_now then 'pos' else null end,
     case when p_pay_now then v_reference else null end,
     case when p_pay_now then now() else null end,
     case when p_pay_now then now() else null end,
     v_service_date, p_arrival_at, v_total::integer, 'pos', p_cashier_profile_id)
  returning * into v_order;
  insert into public.pos_traveller_preorders
    (order_id, order_mode, payment_timing, bus_reference, created_by_profile_id)
  values (v_order.id, p_order_mode, case when p_pay_now then 'booking' else 'arrival' end,
    nullif(btrim(coalesce(p_bus_reference,'')),''), p_cashier_profile_id);
  with requested as (
    select menu_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 200
    group by menu_item_id
  ) insert into public.order_items(order_id, menu_item_id, menu_item_name, quantity, unit_price)
  select v_order.id, mi.id, mi.name, requested.quantity, mi.base_price
  from requested join public.menu_items mi on mi.id = requested.menu_item_id;
  perform public.reserve_paid_order_stock(v_order.id);
  if p_pay_now then
    insert into public.pos_tenders
      (order_id, tender_type, amount, amount_received, payment_reference, captured_by_profile_id)
    values (v_order.id, v_tender, v_total::integer, v_received, v_reference, p_cashier_profile_id);
  end if;
  insert into public.order_status_events(order_id, event_type, from_status, to_status, note)
  values (v_order.id, 'created', null, 'new',
    case when p_pay_now then 'Traveller preorder paid at booking; held for arrival.'
         else 'Traveller preorder stock held; payment due on arrival.' end);
  insert into public.staff_activity_log
    (actor_profile_id, actor_email_snapshot, actor_role_snapshot, action,
     entity_type, entity_id, order_id, summary, metadata)
  values (v_actor.id, v_actor.email, v_actor.role, 'pos.traveller_preorder_created',
    'order', v_order.id::text, v_order.id,
    v_actor.email || ' created traveller preorder ' || v_order.order_number || '.',
    jsonb_build_object('order_mode',p_order_mode,'payment_timing',case when p_pay_now then 'booking' else 'arrival' end,
      'arrival_at',p_arrival_at,'total_amount',v_total));
  update public.pos_sale_requests set order_id = v_order.id, completed_at = now()
  where idempotency_key = p_idempotency_key;
  return query select o.id, o.order_number, o.status, o.payment_status,
    o.total_amount, t.tender_type, t.amount_received, t.change_given, o.promised_at
  from public.orders o left join public.pos_tenders t on t.order_id = o.id
  where o.id = v_order.id;
end;
$$;

revoke all on function public.create_pos_traveller_preorder(uuid,text,uuid,text,text,text,text,timestamptz,boolean,text,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_pos_traveller_preorder(uuid,text,uuid,text,text,text,text,timestamptz,boolean,text,integer,text,jsonb) to service_role;

-- phase-92-traveller-preorder-arrival.sql
create or replace function public.pay_pos_traveller_preorder(
  p_order_id bigint,
  p_cashier_profile_id uuid,
  p_tender_type text,
  p_amount_received integer,
  p_payment_reference text
)
returns table (
  id bigint, order_number text, status text, payment_status text,
  total_amount integer, tender_type text, amount_received integer,
  change_given integer, promised_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_preorder public.pos_traveller_preorders%rowtype;
  v_actor public.profiles%rowtype;
  v_existing_tender public.pos_tenders%rowtype;
  v_tender text := lower(btrim(coalesce(p_tender_type,'')));
  v_reference text := nullif(btrim(coalesce(p_payment_reference,'')), '');
begin
  select * into v_actor from public.profiles profile where profile.id = p_cashier_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'cashier'::public.app_role,'staff'::public.app_role) then
    raise exception 'pos_access_denied';
  end if;
  select * into v_order from public.orders where orders.id = p_order_id for update;
  select * into v_preorder from public.pos_traveller_preorders where order_id = p_order_id for update;
  if v_order.id is null or v_preorder.order_id is null or v_preorder.payment_timing <> 'arrival' then
    raise exception 'pay_on_arrival_preorder_not_found';
  end if;
  if v_tender not in ('cash','mobile_money','card') then raise exception 'invalid_pos_tender'; end if;
  if v_tender = 'cash' then
    if p_amount_received is null or p_amount_received < v_order.total_amount then
      raise exception 'insufficient_cash_received';
    end if;
  elsif p_amount_received <> v_order.total_amount or v_reference is null then
    raise exception 'non_cash_tender_requires_exact_amount_and_reference';
  end if;
  select * into v_existing_tender from public.pos_tenders where order_id = p_order_id;
  if found then
    if v_order.payment_status <> 'paid' or v_existing_tender.tender_type <> v_tender
       or v_existing_tender.amount_received <> p_amount_received
       or v_existing_tender.payment_reference is distinct from v_reference then
      raise exception 'preorder_already_paid_with_different_tender';
    end if;
    return query select o.id,o.order_number,o.status,o.payment_status,o.total_amount,
      t.tender_type,t.amount_received,t.change_given,o.promised_at
    from public.orders o join public.pos_tenders t on t.order_id=o.id where o.id=p_order_id;
    return;
  end if;
  if v_order.status <> 'new' or v_order.payment_status <> 'pending'
     or v_order.stock_reservation_status <> 'reserved' or v_order.stock_reserved_at is null then
    raise exception 'preorder_not_ready_for_arrival_payment';
  end if;
  insert into public.pos_tenders
    (order_id,tender_type,amount,amount_received,payment_reference,captured_by_profile_id)
  values (p_order_id,v_tender,v_order.total_amount,p_amount_received,v_reference,p_cashier_profile_id);
  update public.orders set
    payment_status='paid', payment_provider='pos', payment_reference=v_reference,
    payment_last_verified_at=now(), paid_at=now(), status='confirmed'
  where orders.id=p_order_id returning * into v_order;
  update public.pos_traveller_preorders set checked_in_at=now() where order_id=p_order_id;
  insert into public.order_status_events(order_id,event_type,from_status,to_status,note)
  values (p_order_id,'status_changed','new','confirmed','Traveller preorder paid on arrival and sent to kitchen.');
  insert into public.staff_activity_log
    (actor_profile_id,actor_email_snapshot,actor_role_snapshot,action,
     entity_type,entity_id,order_id,summary,metadata)
  values (v_actor.id,v_actor.email,v_actor.role,'pos.traveller_preorder_paid',
    'order',p_order_id::text,p_order_id,
    v_actor.email || ' took arrival payment for preorder ' || v_order.order_number || '.',
    jsonb_build_object('tender_type',v_tender,'amount',v_order.total_amount));
  return query select o.id,o.order_number,o.status,o.payment_status,o.total_amount,
    t.tender_type,t.amount_received,t.change_given,o.promised_at
  from public.orders o join public.pos_tenders t on t.order_id=o.id where o.id=p_order_id;
end;
$$;

create or replace function public.check_in_paid_pos_traveller_preorder(
  p_order_id bigint, p_staff_profile_id uuid
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_preorder public.pos_traveller_preorders%rowtype;
  v_actor public.profiles%rowtype;
begin
  select * into v_actor from public.profiles where id=p_staff_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'cashier'::public.app_role,'staff'::public.app_role) then
    raise exception 'pos_access_denied';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  select * into v_preorder from public.pos_traveller_preorders where order_id=p_order_id for update;
  if v_order.id is null or v_preorder.order_id is null or v_preorder.payment_timing <> 'booking' then
    raise exception 'paid_at_booking_preorder_not_found';
  end if;
  if v_order.status='confirmed' and v_preorder.checked_in_at is not null then return v_order; end if;
  if v_order.status <> 'new' or v_order.payment_status <> 'paid'
     or v_order.stock_reservation_status <> 'reserved' or v_order.stock_reserved_at is null then
    raise exception 'preorder_not_ready_for_check_in';
  end if;
  update public.orders set status='confirmed' where id=p_order_id returning * into v_order;
  update public.pos_traveller_preorders set checked_in_at=now() where order_id=p_order_id;
  insert into public.order_status_events(order_id,event_type,from_status,to_status,note)
  values (p_order_id,'status_changed','new','confirmed','Paid traveller preorder checked in and sent to kitchen.');
  insert into public.staff_activity_log
    (actor_profile_id,actor_email_snapshot,actor_role_snapshot,action,
     entity_type,entity_id,order_id,summary,metadata)
  values (v_actor.id,v_actor.email,v_actor.role,'pos.traveller_preorder_checked_in',
    'order',p_order_id::text,p_order_id,
    v_actor.email || ' checked in traveller preorder ' || v_order.order_number || '.',
    jsonb_build_object('arrival_at',v_order.promised_at));
  return v_order;
end;
$$;

revoke all on function public.pay_pos_traveller_preorder(bigint,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.pay_pos_traveller_preorder(bigint,uuid,text,integer,text) to service_role;
revoke all on function public.check_in_paid_pos_traveller_preorder(bigint,uuid) from public,anon,authenticated;
grant execute on function public.check_in_paid_pos_traveller_preorder(bigint,uuid) to service_role;

-- phase-93-traveller-counter-sale.sql
-- Scoped combined/passenger counter sales for traveller SKUs. The booking and
-- check-in calls run in one database transaction, so payment, stock, and the
-- kitchen handoff commit together. Ordinary POS quantity limits stay at 20.
create or replace function public.create_pos_traveller_counter_sale(
  p_idempotency_key uuid,
  p_request_hash text,
  p_cashier_profile_id uuid,
  p_order_mode text,
  p_customer_name text,
  p_customer_phone text,
  p_bus_reference text,
  p_tender_type text,
  p_amount_received integer,
  p_payment_reference text,
  p_items jsonb
)
returns table (
  id bigint, order_number text, status text, payment_status text,
  total_amount integer, tender_type text, amount_received integer,
  change_given integer, promised_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_booking record;
begin
  select * into v_booking from public.create_pos_traveller_preorder(
    p_idempotency_key, p_request_hash, p_cashier_profile_id, p_order_mode,
    p_customer_name, p_customer_phone, p_bus_reference,
    now() + interval '1 second', true, p_tender_type,
    p_amount_received, p_payment_reference, p_items
  );
  if v_booking.id is null then raise exception 'traveller_counter_booking_missing'; end if;
  perform public.check_in_paid_pos_traveller_preorder(v_booking.id, p_cashier_profile_id);
  return query select o.id, o.order_number, o.status, o.payment_status,
    o.total_amount, t.tender_type, t.amount_received, t.change_given, o.promised_at
  from public.orders o join public.pos_tenders t on t.order_id=o.id
  where o.id=v_booking.id;
end;
$$;

revoke all on function public.create_pos_traveller_counter_sale(uuid,text,uuid,text,text,text,text,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_pos_traveller_counter_sale(uuid,text,uuid,text,text,text,text,text,integer,text,jsonb) to service_role;

-- phase-94-traveller-preorder-reconciliation.sql
-- Count pending traveller holds as genuine reserved stock, and treat paid
-- preorders awaiting check-in as scheduled rather than failed fulfillment.
create or replace function public.get_daily_menu_stock(p_stock_date date)
returns table (
  stock_date date,
  portion_type_id bigint,
  portion_code text,
  portion_name text,
  portion_label text,
  protein_name text,
  packaging_type_name text,
  starting_quantity integer,
  reserved_quantity integer,
  sold_quantity integer,
  waste_quantity integer,
  remaining_quantity integer,
  is_initialized boolean
)
language sql
stable
as $$
  with order_item_totals as (
    select
      requirement.portion_type_id,
      sum(case when o.stock_reservation_status = 'reserved'
        and o.status <> 'cancelled'
        and (o.payment_status = 'paid' or (
          o.payment_status = 'pending' and preorder.payment_timing = 'arrival'
        )) then requirement.quantity_required else 0 end)::integer as reserved_quantity,
      sum(case when o.stock_reservation_status = 'finalized'
        and o.payment_status = 'paid'
        then requirement.quantity_required else 0 end)::integer as sold_quantity
    from public.orders o
    cross join lateral public.get_order_stock_requirements(o.id) requirement
    left join public.pos_traveller_preorders preorder on preorder.order_id = o.id
    where o.service_date = p_stock_date
    group by requirement.portion_type_id
  )
  select
    p_stock_date as stock_date,
    pt.id as portion_type_id,
    pt.code as portion_code,
    pt.name as portion_name,
    pt.portion_label,
    pr.name as protein_name,
    pkg.name as packaging_type_name,
    case
      when pt.stock_source_portion_type_id is not null
      then floor(coalesce(src_ds.starting_quantity, src_fs.current_quantity, 0)::numeric / pt.stock_source_units_per_serving)::integer
      else coalesce(ds.starting_quantity, fs.current_quantity, 0)
    end as starting_quantity,
    coalesce(ot.reserved_quantity, 0) as reserved_quantity,
    coalesce(ot.sold_quantity, 0) as sold_quantity,
    case
      when pt.stock_source_portion_type_id is not null then 0
      else coalesce(ds.waste_quantity, 0)
    end as waste_quantity,
    case
      when pt.stock_source_portion_type_id is not null
      then floor(coalesce(src_ds.remaining_quantity, src_fs.current_quantity, 0)::numeric / pt.stock_source_units_per_serving)::integer
      else coalesce(ds.remaining_quantity, fs.current_quantity, 0)
    end as remaining_quantity,
    case
      when pt.stock_source_portion_type_id is not null then (src_ds.portion_type_id is not null)
      else (ds.portion_type_id is not null)
    end as is_initialized
  from public.portion_types pt
  left join public.proteins pr
    on pr.id = pt.protein_id
  left join public.packaging_types pkg
    on pkg.id = pt.packaging_type_id
  left join public.daily_stock ds
    on ds.portion_type_id = pt.id
   and ds.stock_date = p_stock_date
  left join public.daily_stock src_ds
    on src_ds.portion_type_id = pt.stock_source_portion_type_id
   and src_ds.stock_date = p_stock_date
  left join public.finished_stock fs
    on fs.portion_type_id = pt.id
  left join public.finished_stock src_fs
    on src_fs.portion_type_id = pt.stock_source_portion_type_id
  left join order_item_totals ot
    on ot.portion_type_id = pt.id
  where pt.is_active = true
  order by pt.sort_order, pt.id;
$$;

create or replace function public.get_business_truth_health_snapshot(
  p_now timestamptz default now(),
  p_service_date date default current_date
)
returns table (
  generated_at timestamptz,
  critical_count integer,
  warning_count integer,
  sections jsonb
)
language sql
stable
as $$
  with
  paid_missing_stock as (
    select
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.stock_reservation_status,
      o.stock_reservation_error,
      o.created_at
    from public.orders o
    where o.payment_status = 'paid'
      and o.status <> 'cancelled'
      and o.stock_reserved_at is null
      and coalesce(o.stock_reservation_status, 'not_started') not in ('reserved', 'finalized')
    order by o.created_at desc
  ),
  unpaid_in_kitchen as (
    select
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.created_at
    from public.orders o
    where coalesce(o.payment_status, 'pending') <> 'paid'
      and o.status in ('confirmed', 'in_prep', 'ready', 'completed')
    order by o.created_at desc
  ),
  paid_not_in_flow as (
    select
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.fulfillment_review_required,
      o.fulfillment_review_reason,
      o.created_at
    from public.orders o
    where o.payment_status = 'paid'
      and o.status in ('new', 'cancelled')
      and coalesce(o.fulfillment_review_required, false) = false
      and not (o.status = 'new' and exists (
        select 1 from public.pos_traveller_preorders preorder
        where preorder.order_id = o.id and preorder.payment_timing = 'booking'
      ))
    order by o.created_at desc
  ),
  cancelled_provider_paid as (
    select distinct
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      pa.provider,
      pa.provider_reference,
      pa.verified_at,
      o.created_at
    from public.orders o
    join public.payment_attempts pa
      on pa.order_id = o.id
    where (o.status = 'cancelled' or o.payment_status = 'cancelled')
      and pa.payment_status = 'paid'
    order by o.created_at desc
  ),
  stale_payment_recoveries as (
    select
      r.id,
      r.order_id,
      o.order_number,
      r.status,
      r.attempt_count,
      r.next_attempt_at,
      r.locked_at,
      r.last_error
    from public.pending_payment_recoveries r
    left join public.orders o
      on o.id = r.order_id
    where r.completed_at is null
      and (
        r.next_attempt_at <= p_now - interval '5 minutes'
        or r.locked_at <= p_now - interval '5 minutes'
        or r.status = 'failed'
      )
    order by coalesce(r.next_attempt_at, r.created_at) asc
  ),
  latest_finished_movements as (
    select distinct on (fsm.portion_type_id)
      fsm.portion_type_id,
      fsm.resulting_quantity,
      fsm.created_at
    from public.finished_stock_movements fsm
    order by fsm.portion_type_id, fsm.created_at desc, fsm.id desc
  ),
  finished_stock_drift as (
    select
      fs.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      fs.current_quantity,
      lfm.resulting_quantity as movement_quantity,
      lfm.created_at as last_movement_at
    from public.finished_stock fs
    join public.portion_types pt
      on pt.id = fs.portion_type_id
    left join latest_finished_movements lfm
      on lfm.portion_type_id = fs.portion_type_id
    where lfm.portion_type_id is not null
      and fs.current_quantity <> lfm.resulting_quantity
    order by abs(fs.current_quantity - lfm.resulting_quantity) desc, pt.sort_order, pt.id
  ),
  daily_paid_totals as (
    select
      requirement.portion_type_id,
      sum(case when o.stock_reservation_status = 'reserved'
        and o.status <> 'cancelled'
        and (o.payment_status = 'paid' or (
          o.payment_status = 'pending' and preorder.payment_timing = 'arrival'
        )) then requirement.quantity_required else 0 end)::integer as expected_reserved_quantity,
      sum(case when o.stock_reservation_status = 'finalized'
        and o.payment_status = 'paid'
        then requirement.quantity_required else 0 end)::integer as expected_sold_quantity
    from public.orders o
    cross join lateral public.get_order_stock_requirements(o.id) requirement
    left join public.pos_traveller_preorders preorder on preorder.order_id = o.id
    where o.service_date = p_service_date
    group by requirement.portion_type_id
  ),
  daily_stock_drift as (
    select
      ds.stock_date,
      ds.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      ds.reserved_quantity,
      coalesce(dpt.expected_reserved_quantity, 0) as expected_reserved_quantity,
      ds.sold_quantity,
      coalesce(dpt.expected_sold_quantity, 0) as expected_sold_quantity
    from public.daily_stock ds
    join public.portion_types pt
      on pt.id = ds.portion_type_id
    left join daily_paid_totals dpt
      on dpt.portion_type_id = ds.portion_type_id
    where ds.stock_date = p_service_date
      and (
        ds.reserved_quantity <> coalesce(dpt.expected_reserved_quantity, 0)
        or ds.sold_quantity <> coalesce(dpt.expected_sold_quantity, 0)
      )
    order by pt.sort_order, pt.id
  ),
  negative_or_zero_truth as (
    select
      fs.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      fs.current_quantity
    from public.finished_stock fs
    join public.portion_types pt
      on pt.id = fs.portion_type_id
    where fs.current_quantity < 0
    order by fs.current_quantity asc, pt.sort_order, pt.id
  ),
  counts as (
    select
      (select count(*) from paid_missing_stock) as paid_missing_stock_count,
      (select count(*) from unpaid_in_kitchen) as unpaid_in_kitchen_count,
      (select count(*) from paid_not_in_flow) as paid_not_in_flow_count,
      (select count(*) from cancelled_provider_paid) as cancelled_provider_paid_count,
      (select count(*) from stale_payment_recoveries) as stale_payment_recoveries_count,
      (select count(*) from finished_stock_drift) as finished_stock_drift_count,
      (select count(*) from daily_stock_drift) as daily_stock_drift_count,
      (select count(*) from negative_or_zero_truth) as negative_stock_count
  )
  select
    p_now as generated_at,
    (
      c.paid_missing_stock_count
      + c.unpaid_in_kitchen_count
      + c.paid_not_in_flow_count
      + c.cancelled_provider_paid_count
      + c.finished_stock_drift_count
      + c.daily_stock_drift_count
      + c.negative_stock_count
    )::integer as critical_count,
    c.stale_payment_recoveries_count::integer as warning_count,
    jsonb_build_array(
      jsonb_build_object(
        'key', 'paid_missing_stock',
        'title', 'Paid orders missing stock reservation',
        'severity', 'critical',
        'count', c.paid_missing_stock_count,
        'description', 'Paid orders that have not reserved/finalized stock.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from paid_missing_stock limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'unpaid_in_kitchen',
        'title', 'Unpaid orders in kitchen flow',
        'severity', 'critical',
        'count', c.unpaid_in_kitchen_count,
        'description', 'Orders not marked paid but already confirmed, in prep, ready, or completed.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from unpaid_in_kitchen limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'paid_not_in_flow',
        'title', 'Paid orders outside staff flow',
        'severity', 'critical',
        'count', c.paid_not_in_flow_count,
        'description', 'Paid orders still new/cancelled without fulfillment review.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from paid_not_in_flow limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'cancelled_provider_paid',
        'title', 'Cancelled local orders with paid provider attempt',
        'severity', 'critical',
        'count', c.cancelled_provider_paid_count,
        'description', 'Local cancellation conflicts with provider-paid evidence.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from cancelled_provider_paid limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'finished_stock_drift',
        'title', 'Finished stock differs from latest movement',
        'severity', 'critical',
        'count', c.finished_stock_drift_count,
        'description', 'Durable stock balance does not match the latest movement result.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from finished_stock_drift limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'daily_stock_drift',
        'title', 'Daily stock differs from paid order totals',
        'severity', 'critical',
        'count', c.daily_stock_drift_count,
        'description', 'Today reserved/sold counts differ from paid reserved/finalized orders.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from daily_stock_drift limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'negative_stock',
        'title', 'Negative finished stock',
        'severity', 'critical',
        'count', c.negative_stock_count,
        'description', 'Finished stock quantity is below zero.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from negative_or_zero_truth limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'stale_payment_recoveries',
        'title', 'Stale pending payment recoveries',
        'severity', 'warning',
        'count', c.stale_payment_recoveries_count,
        'description', 'Recovery rows are due, stalled, or failed.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from stale_payment_recoveries limit 10) row), '[]'::jsonb)
      )
    ) as sections
  from counts c;
$$;

revoke all on function public.get_daily_menu_stock(date) from public,anon,authenticated;
grant execute on function public.get_daily_menu_stock(date) to service_role;
revoke all on function public.get_business_truth_health_snapshot(timestamptz,date) from public,anon,authenticated;
grant execute on function public.get_business_truth_health_snapshot(timestamptz,date) to service_role;

-- phase-95-traveller-paid-cancellation-guard.sql
-- A POS tender has no refund ledger yet. Reject cancellation of a paid traveller
-- order instead of marking it cancelled while retaining payment and held stock.
create or replace function public.guard_paid_traveller_preorder_cancellation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled'
     and exists (select 1 from public.pos_traveller_preorders where order_id = old.id)
     and (old.payment_status = 'paid' or exists (
       select 1 from public.pos_tenders where order_id = old.id
     )) then
    raise exception 'paid_traveller_preorder_requires_refund_workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_paid_traveller_preorder_cancellation on public.orders;
create trigger orders_guard_paid_traveller_preorder_cancellation
before update of status on public.orders
for each row execute function public.guard_paid_traveller_preorder_cancellation();

create or replace function public.cancel_unpaid_pos_traveller_preorder(
  p_order_id bigint, p_staff_profile_id uuid
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_actor from public.profiles where id=p_staff_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'cashier'::public.app_role,'staff'::public.app_role) then
    raise exception 'pos_access_denied';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or not exists (
    select 1 from public.pos_traveller_preorders where order_id=p_order_id
  ) then raise exception 'traveller_preorder_not_found'; end if;
  if v_order.status='cancelled' and v_order.payment_status='cancelled' then return v_order; end if;
  if v_order.status<>'new' or v_order.payment_status<>'pending'
     or v_order.stock_reservation_status<>'reserved' then
    raise exception 'only_unpaid_new_traveller_preorders_can_be_cancelled';
  end if;
  select * into v_order from public.transition_order_status(
    p_order_id,'cancelled','Unpaid traveller preorder cancelled; held stock released.');
  insert into public.staff_activity_log
    (actor_profile_id,actor_email_snapshot,actor_role_snapshot,action,
     entity_type,entity_id,order_id,summary,metadata)
  values (v_actor.id,v_actor.email,v_actor.role,'pos.traveller_preorder_cancelled',
    'order',p_order_id::text,p_order_id,
    v_actor.email || ' cancelled unpaid traveller preorder ' || v_order.order_number || '.',
    '{}'::jsonb);
  return v_order;
end;
$$;
revoke all on function public.cancel_unpaid_pos_traveller_preorder(bigint,uuid) from public,anon,authenticated;
grant execute on function public.cancel_unpaid_pos_traveller_preorder(bigint,uuid) to service_role;

-- phase-96-traveller-counted-components.sql
-- Prepared salad and filled sauce cups, plus universal 330ml soda bottles/cans, are
-- counted as finished servings. A recorded batch reference prevents duplicate
-- posting. This does not reclassify existing raw supply balances.
create table if not exists public.traveller_component_restocks (
  id bigint generated always as identity primary key,
  portion_type_id bigint not null references public.portion_types(id) on delete restrict,
  source_reference text not null check (length(btrim(source_reference)) between 1 and 120),
  quantity_counted integer not null check (quantity_counted between 1 and 10000),
  source_units_consumed numeric(12,2),
  note text,
  recorded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (portion_type_id, source_reference)
);
alter table public.traveller_component_restocks enable row level security;
revoke all on public.traveller_component_restocks from public, anon, authenticated;
grant all on public.traveller_component_restocks to service_role;
grant usage, select on sequence public.traveller_component_restocks_id_seq to service_role;

create or replace function public.record_traveller_component_restock(
  p_portion_code text,
  p_source_reference text,
  p_quantity_counted integer,
  p_actor_profile_id uuid,
  p_source_units_consumed numeric(12,2) default null,
  p_note text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_portion public.portion_types%rowtype;
  v_actor public.profiles%rowtype;
  v_restock_id bigint;
  v_stock public.finished_stock%rowtype;
  v_soda_input public.inventory_items%rowtype;
  v_sauce_input public.inventory_items%rowtype;
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  select * into v_actor from public.profiles where id = p_actor_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'chef'::public.app_role,'staff'::public.app_role) then
    raise exception 'procurement_access_denied';
  end if;
  if p_portion_code not in ('traveller_salad','traveller_sauce','soda_bottle_330ml')
     or p_quantity_counted is null or p_quantity_counted not between 1 and 10000
     or length(btrim(coalesce(p_source_reference,''))) not between 1 and 120 then
    raise exception 'invalid_traveller_component_restock';
  end if;
  select * into v_portion from public.portion_types
  where code = p_portion_code and is_active for update;
  if not found or v_portion.stock_source_portion_type_id is not null then
    raise exception 'traveller_component_portion_not_configured';
  end if;
  if p_portion_code = 'soda_bottle_330ml' then
    if p_source_units_consumed is null or p_source_units_consumed <= 0
       or trunc(p_source_units_consumed) <> p_source_units_consumed then
      raise exception 'soda_cartons_consumed_required';
    end if;
    select * into v_soda_input from public.inventory_items
    where code='soda' and lower(unit_name)='carton' for update;
    if not found or v_soda_input.current_quantity < p_source_units_consumed then
      raise exception 'insufficient_raw_soda_cartons';
    end if;
  elsif p_portion_code = 'traveller_sauce' then
    if p_source_units_consumed is null or p_source_units_consumed < 0
       or p_source_units_consumed > p_quantity_counted
       or trunc(p_source_units_consumed) <> p_source_units_consumed then
      raise exception 'sauce_cups_used_count_required';
    end if;
    if p_source_units_consumed > 0 then
      select * into v_sauce_input from public.inventory_items
      where code='sauce_cups' and lower(unit_name) in ('pcs','pieces') for update;
      if not found or v_sauce_input.current_quantity < p_source_units_consumed then
        raise exception 'insufficient_raw_sauce_cups';
      end if;
    end if;
  elsif p_source_units_consumed is not null then
    raise exception 'source_units_not_applicable_to_salad';
  end if;
  insert into public.traveller_component_restocks
    (portion_type_id,source_reference,quantity_counted,source_units_consumed,note,recorded_by_profile_id)
  values (v_portion.id,btrim(p_source_reference),p_quantity_counted,p_source_units_consumed,
    nullif(btrim(coalesce(p_note,'')),''),p_actor_profile_id)
  returning id into v_restock_id;
  if p_portion_code = 'traveller_sauce' and p_source_units_consumed > 0 then
    update public.inventory_items
    set current_quantity=current_quantity-p_source_units_consumed
    where id=v_sauce_input.id returning * into v_sauce_input;
    insert into public.inventory_movements
      (inventory_item_id,movement_type,quantity_delta,resulting_quantity,note)
    values (v_sauce_input.id,'usage',-p_source_units_consumed,v_sauce_input.current_quantity,
      format('Counted traveller sauce restock %s: %s filled servings',v_restock_id,p_quantity_counted));
  end if;
  if p_portion_code = 'soda_bottle_330ml' then
    update public.inventory_items
    set current_quantity=current_quantity-p_source_units_consumed
    where id=v_soda_input.id returning * into v_soda_input;
    insert into public.inventory_movements
      (inventory_item_id,movement_type,quantity_delta,resulting_quantity,note)
    values (v_soda_input.id,'usage',-p_source_units_consumed,v_soda_input.current_quantity,
      format('Counted traveller soda restock %s: %s bottles/cans',v_restock_id,p_quantity_counted));
  end if;
  insert into public.finished_stock(portion_type_id,current_quantity)
  values (v_portion.id,p_quantity_counted)
  on conflict (portion_type_id) do update
  set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
  returning * into v_stock;
  insert into public.finished_stock_movements
    (portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
  values (v_portion.id,'production',p_quantity_counted,v_stock.current_quantity,
    format('Counted traveller restock %s, source %s',v_restock_id,btrim(p_source_reference)));
  insert into public.daily_stock(stock_date,portion_type_id,starting_quantity)
  values (v_today,v_portion.id,v_stock.current_quantity)
  on conflict (stock_date,portion_type_id) do update
  set starting_quantity = public.daily_stock.starting_quantity + p_quantity_counted;
  return v_restock_id;
end;
$$;
revoke all on function public.record_traveller_component_restock(text,text,integer,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.record_traveller_component_restock(text,text,integer,uuid,numeric,text) to service_role;

-- phase-97-traveller-beef-conversion.sql
-- Staff selects the physical cooked batch. Current sales consume a pooled
-- finished-stock balance, so batch identity is an attestation rather than a
-- claim that historical sales have been assigned to particular batches.
create table if not exists public.traveller_beef_conversions (
  id bigint generated always as identity primary key,
  source_processing_batch_id bigint not null references public.processing_batches(id) on delete restrict,
  source_portion_type_id bigint not null references public.portion_types(id) on delete restrict,
  source_portions_used integer not null check (source_portions_used between 1 and 10000),
  skewers_produced integer not null check (skewers_produced between 0 and 10000),
  samosas_produced integer not null check (samosas_produced between 0 and 10000),
  cooked_on date not null,
  early_conversion_acknowledged boolean not null default false,
  batch_reference text not null check (length(btrim(batch_reference)) between 1 and 120),
  note text,
  recorded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (source_processing_batch_id,batch_reference),
  check (skewers_produced + samosas_produced > 0)
);
alter table public.traveller_beef_conversions enable row level security;
revoke all on public.traveller_beef_conversions from public,anon,authenticated;
grant all on public.traveller_beef_conversions to service_role;
grant usage, select on sequence public.traveller_beef_conversions_id_seq to service_role;

create or replace view public.traveller_beef_conversion_totals as
select source_processing_batch_id, sum(source_portions_used)::integer as portions_converted
from public.traveller_beef_conversions
group by source_processing_batch_id;
revoke all on public.traveller_beef_conversion_totals from public,anon,authenticated;
grant select on public.traveller_beef_conversion_totals to service_role;
create or replace function public.convert_cooked_beef_to_traveller_pieces(
  p_source_processing_batch_id bigint,
  p_source_portions_used integer,
  p_skewers_produced integer,
  p_samosas_produced integer,
  p_cooked_on date,
  p_early_conversion_acknowledged boolean,
  p_batch_reference text,
  p_actor_profile_id uuid,
  p_note text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_batch public.processing_batches%rowtype;
  v_portion public.portion_types%rowtype;
  v_source_stock public.finished_stock%rowtype;
  v_output_stock public.finished_stock%rowtype;
  v_output_id bigint;
  v_output_code text;
  v_output_count integer;
  v_conversion_id bigint;
  v_prior_count integer;
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  select * into v_actor from public.profiles where id=p_actor_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'chef'::public.app_role,'staff'::public.app_role) then
    raise exception 'procurement_access_denied';
  end if;
  if p_source_portions_used is null or p_source_portions_used not between 1 and 10000
     or p_skewers_produced is null or p_skewers_produced not between 0 and 10000
     or p_samosas_produced is null or p_samosas_produced not between 0 and 10000
     or p_skewers_produced+p_samosas_produced < 1
     or p_cooked_on is null or p_cooked_on > v_today
     or length(btrim(coalesce(p_batch_reference,''))) not between 1 and 120 then
    raise exception 'invalid_traveller_beef_conversion';
  end if;
  select * into v_batch from public.processing_batches
  where id=p_source_processing_batch_id for update;
  if not found then raise exception 'source_processing_batch_not_found'; end if;
  select * into v_portion from public.portion_types where id=v_batch.portion_type_id;
  if not found or not exists (
    select 1 from public.proteins protein
    where protein.id=v_portion.protein_id and protein.code='beef'
  ) or v_portion.stock_source_portion_type_id is not null then
    raise exception 'beef_finished_portion_required';
  end if;
  if p_cooked_on > (v_batch.created_at at time zone 'Africa/Kampala')::date then
    raise exception 'cook_date_after_processing_batch';
  end if;
  if p_cooked_on > v_today-2 and not coalesce(p_early_conversion_acknowledged,false) then
    raise exception 'conversion_under_two_days_requires_acknowledgement';
  end if;
  select coalesce(sum(source_portions_used),0)::integer into v_prior_count
  from public.traveller_beef_conversions where source_processing_batch_id=v_batch.id;
  if v_prior_count+p_source_portions_used > v_batch.quantity_produced then
    raise exception 'source_batch_conversion_count_exceeded';
  end if;
  select * into v_source_stock from public.finished_stock
  where portion_type_id=v_portion.id for update;
  if not found or v_source_stock.current_quantity < p_source_portions_used then
    raise exception 'insufficient_beef_finished_stock';
  end if;
  insert into public.traveller_beef_conversions
    (source_processing_batch_id,source_portion_type_id,source_portions_used,
     skewers_produced,samosas_produced,cooked_on,early_conversion_acknowledged,
     batch_reference,note,recorded_by_profile_id)
  values (v_batch.id,v_portion.id,p_source_portions_used,p_skewers_produced,
    p_samosas_produced,p_cooked_on,coalesce(p_early_conversion_acknowledged,false),
    btrim(p_batch_reference),nullif(btrim(coalesce(p_note,'')),''),p_actor_profile_id)
  returning id into v_conversion_id;
  update public.finished_stock set current_quantity=current_quantity-p_source_portions_used
  where portion_type_id=v_portion.id returning * into v_source_stock;
  insert into public.finished_stock_movements
    (portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
  values (v_portion.id,'adjustment',-p_source_portions_used,v_source_stock.current_quantity,
    format('Converted to traveller beef pieces, conversion %s',v_conversion_id));
  update public.daily_stock
  set starting_quantity=starting_quantity-p_source_portions_used
  where stock_date=v_today and portion_type_id=v_portion.id
    and remaining_quantity >= p_source_portions_used;
  if not found and exists (select 1 from public.daily_stock where stock_date=v_today and portion_type_id=v_portion.id) then
    raise exception 'insufficient_service_day_beef_stock';
  end if;
  for v_output_code,v_output_count in
    select * from (values
      ('traveller_beef_skewer',p_skewers_produced),
      ('traveller_beef_samosa_piece',p_samosas_produced)
    ) as output(code,quantity)
  loop
    if v_output_count > 0 then
      select id into v_output_id from public.portion_types
      where code=v_output_code and is_active and stock_source_portion_type_id is null;
      if v_output_id is null then raise exception 'traveller_beef_output_not_configured'; end if;
      insert into public.finished_stock(portion_type_id,current_quantity)
      values (v_output_id,v_output_count)
      on conflict (portion_type_id) do update
      set current_quantity=public.finished_stock.current_quantity+excluded.current_quantity
      returning * into v_output_stock;
      insert into public.finished_stock_movements
        (portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
      values (v_output_id,'production',v_output_count,v_output_stock.current_quantity,
        format('Traveller beef conversion %s from batch %s',v_conversion_id,v_batch.id));
      insert into public.daily_stock(stock_date,portion_type_id,starting_quantity)
      values (v_today,v_output_id,v_output_stock.current_quantity)
      on conflict (stock_date,portion_type_id) do update
      set starting_quantity=public.daily_stock.starting_quantity+v_output_count;
    end if;
  end loop;
  return v_conversion_id;
end;
$$;
revoke all on function public.convert_cooked_beef_to_traveller_pieces(bigint,integer,integer,integer,date,boolean,text,uuid,text) from public,anon,authenticated;
grant execute on function public.convert_cooked_beef_to_traveller_pieces(bigint,integer,integer,integer,date,boolean,text,uuid,text) to service_role;

commit;