-- Phase 84: repair Samosa as a one-piece direct-sellable item.
-- The original 140 g receipt represented thirteen samosas. Preserve that
-- historical intent while moving future intake and sales to whole pieces.

begin;

do $$
declare
  v_menu_item public.menu_items%rowtype;
  v_portion_type public.portion_types%rowtype;
  v_inventory_item public.inventory_items%rowtype;
  v_receipt public.procurement_receipts%rowtype;
  v_receipt_id bigint;
  v_receipt_count integer;
  v_movement_count integer;
begin
  select * into v_menu_item
  from public.menu_items
  where code = 'samosa'
  for update;

  if not found then
    raise exception 'phase_84_samosa_menu_item_missing';
  end if;

  select * into v_portion_type
  from public.portion_types
  where code = 'samosa'
  for update;

  if not found or v_menu_item.portion_type_id <> v_portion_type.id then
    raise exception 'phase_84_samosa_portion_mapping_invalid';
  end if;

  select * into v_inventory_item
  from public.inventory_items
  where code = 'samosas'
  for update;

  if not found then
    raise exception 'phase_84_samosa_inventory_item_missing';
  end if;

  if exists (
    select 1
    from public.inventory_items
    where id <> v_inventory_item.id
      and (
        direct_sellable_portion_type_id = v_portion_type.id
        or source_menu_item_id = v_menu_item.id
      )
  ) then
    raise exception 'phase_84_samosa_mapping_conflict';
  end if;

  select count(*), min(id)
  into v_receipt_count, v_receipt_id
  from public.procurement_receipts
  where inventory_item_id = v_inventory_item.id;

  if v_receipt_count <> 1 then
    raise exception 'phase_84_expected_one_samosa_receipt_found_%', v_receipt_count;
  end if;

  select * into v_receipt
  from public.procurement_receipts
  where id = v_receipt_id
  for update;

  if v_receipt.quantity_received <> 140 or lower(btrim(v_receipt.unit_name)) <> 'g' then
    raise exception 'phase_84_samosa_receipt_baseline_changed';
  end if;

  if v_inventory_item.current_quantity <> 140 then
    raise exception 'phase_84_samosa_inventory_quantity_baseline_changed';
  end if;

  select count(*) into v_movement_count
  from public.inventory_movements
  where inventory_item_id = v_inventory_item.id
    and movement_type = 'restock'
    and quantity_delta = 140
    and resulting_quantity = 140;

  if v_movement_count <> 1 then
    raise exception 'phase_84_samosa_inventory_movement_baseline_changed';
  end if;

  if (select count(*) from public.inventory_movements where inventory_item_id = v_inventory_item.id) <> 1 then
    raise exception 'phase_84_unexpected_samosa_inventory_movements';
  end if;

  if exists (select 1 from public.order_items where menu_item_id = v_menu_item.id) then
    raise exception 'phase_84_samosa_sales_exist_review_before_repair';
  end if;

  if exists (select 1 from public.finished_stock where portion_type_id = v_portion_type.id)
    or exists (select 1 from public.daily_stock where portion_type_id = v_portion_type.id) then
    raise exception 'phase_84_samosa_stock_already_exists';
  end if;

  update public.portion_types
  set portion_label = '1 piece'
  where id = v_portion_type.id;

  update public.inventory_items
  set
    unit_name = 'pieces',
    current_quantity = 0,
    direct_sellable_portion_type_id = v_portion_type.id,
    sellable_units_per_input = 1,
    requires_whole_input = true,
    source_menu_item_id = v_menu_item.id
  where id = v_inventory_item.id;

  update public.procurement_receipts
  set
    item_name = 'Samosa',
    quantity_received = 13,
    unit_name = 'pieces'
  where id = v_receipt.id;

  update public.inventory_movements
  set
    quantity_delta = 13,
    resulting_quantity = 13,
    note = 'Historical Samosa receipt corrected from 140 g to 13 pieces; sellable stock credited separately.'
  where inventory_item_id = v_inventory_item.id
    and movement_type = 'restock'
    and quantity_delta = 140
    and resulting_quantity = 140;

  insert into public.inventory_movements (
    inventory_item_id,
    movement_type,
    quantity_delta,
    resulting_quantity,
    note
  )
  values (
    v_inventory_item.id,
    'adjustment',
    -13,
    0,
    'Phase 84 transfer: 13 Samosa pieces moved from raw inventory to sellable finished stock.'
  );

  insert into public.finished_stock (portion_type_id, current_quantity)
  values (v_portion_type.id, 13);

  insert into public.finished_stock_movements (
    portion_type_id,
    movement_type,
    quantity_delta,
    resulting_quantity,
    processing_batch_id,
    note
  )
  values (
    v_portion_type.id,
    'adjustment',
    13,
    13,
    null,
    'Phase 84 correction: receipt ' || v_receipt.id || ' represents 13 Samosa pieces.'
  );

  insert into public.daily_stock (
    stock_date,
    portion_type_id,
    starting_quantity,
    reserved_quantity,
    sold_quantity,
    waste_quantity
  )
  values (
    v_receipt.delivery_date,
    v_portion_type.id,
    13,
    0,
    0,
    0
  );
end;
$$;

commit;
