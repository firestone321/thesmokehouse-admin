begin;

-- Add the separate 330ml receiving option as whole cartons of 12 bottles,
-- without converting historical unlabeled cartons. The user confirmed a
-- UGX 1,000 selling price and storefront visibility with no stock. Zero stock
-- keeps the visible item unavailable to buy until cartons are received.
do $$
declare
  v_portion public.portion_types%rowtype;
  v_menu public.menu_items%rowtype;
  v_category_id bigint;
  v_input_id bigint;
begin
  select * into strict v_portion from public.portion_types
  where code = 'soda_bottle_330ml' and portion_label = '330ml'
    and is_active and stock_source_portion_type_id is null;

  select id into strict v_category_id from public.menu_categories
  where code = 'drinks';

  select * into v_menu from public.menu_items
  where code = 'soda_330ml' for update;

  if not found then
    if exists (select 1 from public.menu_items where portion_type_id = v_portion.id) then
      raise exception '330ml soda already has another menu item; review required';
    end if;
    insert into public.menu_items (
      code, menu_category_id, portion_type_id, name, description, base_price,
      prep_type, is_active, is_available_today, sort_order, pos_only
    ) values (
      'soda_330ml', v_category_id, v_portion.id, 'Soda (330ml)',
      '330ml soda bottle or can.', 1000, 'drink', true, true, 21, false
    ) returning * into v_menu;
  elsif v_menu.portion_type_id <> v_portion.id
    or v_menu.menu_category_id <> v_category_id then
    raise exception 'Soda 330ml menu configuration differs; review required';
  end if;

  v_input_id := public.ensure_menu_drink_intake_item(v_menu.id);

  -- The trigger-created intake is a new zero-stock item; never repurpose
  -- an existing carton balance or silently overwrite a different conversion.
  if not exists (
    select 1 from public.inventory_items
    where id = v_input_id and code = format('menu_drink_%s', v_menu.id)
      and direct_sellable_portion_type_id = v_portion.id
      and source_menu_item_id = v_menu.id
      and ((sellable_units_per_input = 1 and lower(unit_name) = 'unit')
        or (sellable_units_per_input = 12 and lower(unit_name) = 'carton'))
  ) then
    raise exception 'Soda 330ml intake configuration differs; review required';
  end if;

  update public.inventory_items
  set name = 'Soda (330ml)', unit_name = 'carton',
      sellable_units_per_input = 12,
      requires_whole_input = true, is_active = true
  where id = v_input_id;
end;
$$;

commit;
