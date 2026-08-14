begin;

-- Phase 71: cartons of mineral water are received as 12 individual 500ml bottles.
-- Map the existing inventory item to the customer-facing menu portion, then
-- backfill historical carton receipts once without changing the carton ledger.
do $$
declare
  v_water_input public.inventory_items%rowtype;
  v_water_portion public.portion_types%rowtype;
  v_receipt public.procurement_receipts%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_bottle_quantity integer;
begin
  select * into v_water_portion
  from public.portion_types
  where code = 'mineral_water' and is_active = true;

  if not found then
    raise exception 'Active mineral_water (500ml) sellable portion is required';
  end if;

  select * into v_water_input
  from public.inventory_items
  where code = 'mineral_water'
  for update;

  if not found then
    raise exception 'Mineral Water carton inventory item is required';
  end if;

  update public.inventory_items
  set direct_sellable_portion_type_id = v_water_portion.id,
      sellable_units_per_input = 12,
      requires_whole_input = true,
      source_menu_item_id = (
        select id from public.menu_items
        where portion_type_id = v_water_portion.id
        order by id
        limit 1
      )
  where id = v_water_input.id;

  for v_receipt in
    select * from public.procurement_receipts
    where inventory_item_id = v_water_input.id
      and intake_type = 'ingredient'
      and quantity_received > 0
      and not exists (
        select 1 from public.finished_stock_movements
        where portion_type_id = v_water_portion.id
          and note = format('Carton water stock backfill for receipt %s.', v_receipt.id)
      )
    order by id
  loop
    v_bottle_quantity := floor(v_receipt.quantity_received * 12)::integer;

    insert into public.finished_stock (portion_type_id, current_quantity)
    values (v_water_portion.id, v_bottle_quantity)
    on conflict (portion_type_id) do update
    set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
    returning * into v_finished_stock;

    insert into public.finished_stock_movements (
      portion_type_id, movement_type, quantity_delta, resulting_quantity, processing_batch_id, note
    ) values (
      v_water_portion.id, 'adjustment', v_bottle_quantity, v_finished_stock.current_quantity, null,
      format('Carton water stock backfill for receipt %s.', v_receipt.id)
    );

    insert into public.daily_stock (stock_date, portion_type_id, starting_quantity)
    values (v_receipt.delivery_date, v_water_portion.id, v_bottle_quantity)
    on conflict (stock_date, portion_type_id) do update
    set starting_quantity = public.daily_stock.starting_quantity + excluded.starting_quantity;
  end loop;
end;
$$;

commit;
