begin;

-- Receive future 500ml soda deliveries through Sides & Drinks as whole
-- cartons of 12 bottles. Preserve existing raw and finished stock balances:
-- two historical cartons were already converted separately on 2026-10-29.
do $$
declare
  v_input public.inventory_items%rowtype;
  v_menu public.menu_items%rowtype;
  v_portion public.portion_types%rowtype;
begin
  select mi.* into strict v_menu
  from public.menu_items mi
  join public.menu_categories mc on mc.id = mi.menu_category_id
  join public.portion_types pt on pt.id = mi.portion_type_id
  where mi.code = 'soda' and mc.code = 'drinks'
    and pt.portion_label = '500ml' and pt.is_active
  for update of mi;

  select * into strict v_portion from public.portion_types
  where id = v_menu.portion_type_id and stock_source_portion_type_id is null;

  select * into strict v_input from public.inventory_items
  where code = 'soda_500mls' and item_type = 'ingredient'
  for update;

  if (v_input.direct_sellable_portion_type_id is not null
      and v_input.direct_sellable_portion_type_id <> v_portion.id)
    or (v_input.source_menu_item_id is not null
      and v_input.source_menu_item_id <> v_menu.id) then
    raise exception 'Soda 500ml intake already has a different mapping; review required';
  end if;

  update public.inventory_items
  set name = 'Soda (500ml)', unit_name = 'carton',
      direct_sellable_portion_type_id = v_portion.id,
      source_menu_item_id = v_menu.id,
      sellable_units_per_input = 12,
      requires_whole_input = true,
      is_active = true
  where id = v_input.id;
end;
$$;

commit;
