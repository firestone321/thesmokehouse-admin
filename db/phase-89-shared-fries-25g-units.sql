begin;

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

commit;
