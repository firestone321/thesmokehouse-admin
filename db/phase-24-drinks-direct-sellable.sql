begin;

-- Phase 24: drinks direct-sellable intake.
-- Purpose:
-- 1. Let prepared drinks be logged by litres produced and credited into sellable drink portions.
-- 2. Let soda be received by carton, using the working assumption that one carton has 12 x 350ml plastic bottles.
-- 3. Keep fries direct-sellable behavior while leaving gonja on the regular ingredient-input path.

insert into public.inventory_items (
  code,
  name,
  unit_name,
  item_type,
  current_quantity,
  reorder_threshold,
  is_active
)
values
  ('juice_litre', 'Juice produced', 'litre', 'ingredient', 0, 0, true),
  ('yoghurt_litre', 'Yoghurt produced', 'litre', 'ingredient', 0, 0, true),
  ('soda_carton', 'Soda cartons', 'carton', 'ingredient', 0, 0, true)
on conflict (code) do update
set
  name = excluded.name,
  unit_name = excluded.unit_name,
  item_type = excluded.item_type,
  is_active = excluded.is_active,
  updated_at = now();

do $$
declare
  v_drinks_category_id bigint;
  v_soda_portion_id bigint;
  v_yoghurt_portion_id bigint;
begin
  select id into v_drinks_category_id from public.menu_categories where code = 'drinks';

  if v_drinks_category_id is null then
    insert into public.menu_categories (code, name, sort_order, is_active)
    values ('drinks', 'Drinks', 5, true)
    returning id into v_drinks_category_id;
  end if;

  update public.portion_types
  set
    name = 'Juice',
    portion_label = coalesce(portion_label, '500ml'),
    sort_order = greatest(sort_order, 9),
    is_active = true
  where code = 'juice';

  insert into public.portion_types (code, protein_id, packaging_type_id, name, portion_label, sort_order, is_active)
  values ('soda_350ml', null, null, 'Soda', '350ml', 10, true)
  on conflict (code) do update
  set
    name = excluded.name,
    portion_label = excluded.portion_label,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

  insert into public.portion_types (code, protein_id, packaging_type_id, name, portion_label, sort_order, is_active)
  values ('yoghurt_500ml', null, null, 'Yoghurt', '500ml', 11, true)
  on conflict (code) do update
  set
    name = excluded.name,
    portion_label = excluded.portion_label,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

  select id into v_soda_portion_id from public.portion_types where code = 'soda_350ml';
  select id into v_yoghurt_portion_id from public.portion_types where code = 'yoghurt_500ml';

  insert into public.menu_items (
    code, menu_category_id, portion_type_id, name, description, base_price, prep_type,
    is_active, is_available_today, sort_order
  )
  select
    'soda_350ml', v_drinks_category_id, v_soda_portion_id, 'Soda 350ml',
    'Chilled soda bottle.', 0, 'drink', false, false, 10
  where v_soda_portion_id is not null
    and not exists (select 1 from public.menu_items where code = 'soda_350ml');

  update public.menu_items
  set
    menu_category_id = v_drinks_category_id,
    portion_type_id = v_soda_portion_id,
    name = 'Soda 350ml',
    description = 'Chilled soda bottle.',
    prep_type = 'drink',
    sort_order = 10,
    updated_at = now()
  where code = 'soda_350ml';

  insert into public.menu_items (
    code, menu_category_id, portion_type_id, name, description, base_price, prep_type,
    is_active, is_available_today, sort_order
  )
  select
    'yoghurt_500ml', v_drinks_category_id, v_yoghurt_portion_id, 'Yoghurt 500ml',
    'House-made yoghurt serving.', 0, 'drink', false, false, 11
  where v_yoghurt_portion_id is not null
    and not exists (select 1 from public.menu_items where code = 'yoghurt_500ml');

  update public.menu_items
  set
    menu_category_id = v_drinks_category_id,
    portion_type_id = v_yoghurt_portion_id,
    name = 'Yoghurt 500ml',
    description = 'House-made yoghurt serving.',
    prep_type = 'drink',
    sort_order = 11,
    updated_at = now()
  where code = 'yoghurt_500ml';

  update public.menu_items
  set
    menu_category_id = v_drinks_category_id,
    name = 'Juice 500ml',
    description = 'House-made juice serving.',
    prep_type = 'drink',
    sort_order = 9,
    updated_at = now()
  where code = 'juice';
end;
$$;

create or replace function public.record_procurement_receipt(
  p_intake_type text,
  p_protein_code text default null,
  p_inventory_item_id bigint default null,
  p_supplier_id bigint default null,
  p_supplier_name text default null,
  p_batch_number text default null,
  p_delivery_date date default null,
  p_butchered_on date default null,
  p_abattoir_name text default null,
  p_vet_stamp_number text default null,
  p_inspection_officer_name text default null,
  p_quantity_received numeric(12,2) default null,
  p_unit_name text default null,
  p_unit_cost numeric(12,2) default null,
  p_note text default null,
  p_allocated_to_halves integer default 0,
  p_allocated_to_quarters integer default 0
)
returns public.procurement_receipts
language plpgsql
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_inventory_item public.inventory_items%rowtype;
  v_supplier public.suppliers%rowtype;
  v_item_name text;
  v_supplier_name text;
  v_unit_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_abattoir_name text := nullif(btrim(coalesce(p_abattoir_name, '')), '');
  v_vet_stamp_number text := nullif(btrim(coalesce(p_vet_stamp_number, '')), '');
  v_inspection_officer_name text := nullif(btrim(coalesce(p_inspection_officer_name, '')), '');
  v_direct_sellable_portion_code text := null;
  v_direct_sellable_portion_id bigint := null;
  v_direct_sellable_quantity integer := 0;
  v_finished_stock public.finished_stock%rowtype;
begin
  if p_intake_type not in ('protein', 'ingredient', 'supply') then
    raise exception 'Invalid procurement intake type: %', p_intake_type;
  end if;

  if p_delivery_date is null then
    raise exception 'Delivery date is required';
  end if;

  if p_quantity_received is null or p_quantity_received <= 0 then
    raise exception 'Quantity received must be greater than zero';
  end if;

  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Unit cost cannot be negative';
  end if;

  if p_allocated_to_halves < 0 or p_allocated_to_quarters < 0 then
    raise exception 'Chicken allocations cannot be negative';
  end if;

  if p_supplier_id is not null then
    select * into v_supplier from public.suppliers where id = p_supplier_id;

    if not found then
      raise exception 'Supplier % not found', p_supplier_id;
    end if;
  end if;

  if p_intake_type = 'protein' then
    if p_supplier_id is null then
      raise exception 'Supplier is required for protein receipts';
    end if;

    if p_protein_code not in ('beef_ribs', 'beef_chunks', 'whole_chicken', 'goat_ribs', 'goat_chunks', 'beef', 'goat') then
      raise exception 'Invalid protein procurement code: %', p_protein_code;
    end if;

    if v_batch_number is null then
      raise exception 'Batch number is required for protein receipts';
    end if;

    if p_butchered_on is null then
      raise exception 'Butchered date is required for protein receipts';
    end if;

    if p_butchered_on > p_delivery_date then
      raise exception 'Butchered date cannot be after delivery date';
    end if;

    if v_abattoir_name is null then
      v_abattoir_name := nullif(btrim(coalesce(v_supplier.default_abattoir_name, '')), '');
    end if;

    if v_abattoir_name is null then
      raise exception 'Abattoir name is required for protein receipts';
    end if;

    if v_vet_stamp_number is null then
      raise exception 'Vet stamp number is required for protein receipts';
    end if;

    if v_inspection_officer_name is null then
      raise exception 'Inspection officer name is required for protein receipts';
    end if;

    v_supplier_name := v_supplier.name;
    v_item_name := case p_protein_code
      when 'beef_ribs' then 'Beef ribs'
      when 'beef_chunks' then 'Beef chunks'
      when 'whole_chicken' then 'Whole chicken'
      when 'goat_ribs' then 'Goat ribs'
      when 'goat_chunks' then 'Goat chunks'
      when 'beef' then 'Beef'
      when 'goat' then 'Goat meat'
    end;
    v_unit_name := nullif(btrim(coalesce(p_unit_name, '')), '');

    if v_unit_name is null then
      v_unit_name := case p_protein_code when 'whole_chicken' then 'bird' else 'kg' end;
    end if;

    if p_protein_code = 'whole_chicken' and trunc(p_quantity_received) <> p_quantity_received then
      raise exception 'Whole chicken quantity must be a whole number';
    end if;

    if p_protein_code = 'whole_chicken' then
      if p_allocated_to_halves + p_allocated_to_quarters > p_quantity_received then
        raise exception 'Chicken allocations cannot exceed whole chickens received';
      end if;
    elsif p_allocated_to_halves <> 0 or p_allocated_to_quarters <> 0 then
      raise exception 'Chicken allocations are only allowed for whole chicken receipts';
    end if;
  else
    if v_supplier.name is not null then
      v_supplier_name := v_supplier.name;
    elsif nullif(btrim(coalesce(p_supplier_name, '')), '') is not null then
      v_supplier_name := btrim(p_supplier_name);
    else
      raise exception 'Supplier name is required';
    end if;

    select * into v_inventory_item from public.inventory_items where id = p_inventory_item_id for update;

    if not found then
      raise exception 'Inventory item % not found', p_inventory_item_id;
    end if;

    if p_intake_type = 'ingredient' and v_inventory_item.item_type <> 'ingredient' then
      raise exception 'Inventory item % is not configured as an ingredient item', p_inventory_item_id;
    end if;

    if p_intake_type = 'supply' and v_inventory_item.item_type <> 'supply' then
      raise exception 'Inventory item % is not configured as a supply item', p_inventory_item_id;
    end if;

    v_item_name := v_inventory_item.name;
    v_unit_name := v_inventory_item.unit_name;
    p_protein_code := null;
    p_allocated_to_halves := 0;
    p_allocated_to_quarters := 0;
    p_butchered_on := null;
    v_abattoir_name := null;
    v_vet_stamp_number := null;
    v_inspection_officer_name := null;

    if p_intake_type = 'ingredient' then
      if v_inventory_item.code = 'fries_kg' then
        v_direct_sellable_portion_code := 'fries_250g';
        v_direct_sellable_quantity := floor(p_quantity_received / 0.25);
      elsif v_inventory_item.code = 'juice_litre' then
        v_direct_sellable_portion_code := 'juice';
        v_direct_sellable_quantity := floor(p_quantity_received / 0.5);
      elsif v_inventory_item.code = 'yoghurt_litre' then
        v_direct_sellable_portion_code := 'yoghurt_500ml';
        v_direct_sellable_quantity := floor(p_quantity_received / 0.5);
      elsif v_inventory_item.code = 'soda_carton' then
        if trunc(p_quantity_received) <> p_quantity_received then
          raise exception 'Soda cartons must be received as whole cartons';
        end if;

        v_direct_sellable_portion_code := 'soda_350ml';
        v_direct_sellable_quantity := (p_quantity_received::integer * 12);
      end if;

      if v_direct_sellable_portion_code is not null then
        if v_direct_sellable_quantity <= 0 then
          raise exception 'Receipt quantity is not enough to create one sellable portion for %', v_direct_sellable_portion_code;
        end if;

        select pt.id
        into v_direct_sellable_portion_id
        from public.portion_types pt
        where pt.code = v_direct_sellable_portion_code
          and pt.is_active = true
        limit 1;

        if v_direct_sellable_portion_id is null then
          raise exception 'Direct sellable portion % is missing or inactive', v_direct_sellable_portion_code;
        end if;
      end if;
    end if;
  end if;

  insert into public.procurement_receipts (
    intake_type, protein_code, inventory_item_id, supplier_id, supplier_name, batch_number,
    delivery_date, butchered_on, abattoir_name, vet_stamp_number, inspection_officer_name,
    item_name, quantity_received, unit_name, unit_cost, note, allocated_to_halves, allocated_to_quarters
  )
  values (
    p_intake_type, p_protein_code, p_inventory_item_id, p_supplier_id, v_supplier_name, v_batch_number,
    p_delivery_date, p_butchered_on, v_abattoir_name, v_vet_stamp_number, v_inspection_officer_name,
    v_item_name, p_quantity_received, v_unit_name, p_unit_cost, v_note, p_allocated_to_halves, p_allocated_to_quarters
  )
  returning * into v_receipt;

  if p_intake_type = 'supply' or (p_intake_type = 'ingredient' and v_direct_sellable_portion_id is null) then
    perform public.apply_inventory_adjustment(
      v_inventory_item.id,
      p_quantity_received,
      'restock',
      coalesce(v_note, format('Procurement receipt from %s on %s', v_supplier_name, p_delivery_date))
    );
  end if;

  if v_direct_sellable_portion_id is not null and v_direct_sellable_quantity > 0 then
    insert into public.finished_stock (portion_type_id, current_quantity)
    values (v_direct_sellable_portion_id, v_direct_sellable_quantity)
    on conflict (portion_type_id) do update
    set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
    returning * into v_finished_stock;

    insert into public.finished_stock_movements (
      portion_type_id, movement_type, quantity_delta, resulting_quantity, processing_batch_id, note
    )
    values (
      v_direct_sellable_portion_id,
      'adjustment',
      v_direct_sellable_quantity,
      v_finished_stock.current_quantity,
      null,
      coalesce(
        v_note,
        format(
          'Direct sellable %s receipt %s from %s on %s',
          v_direct_sellable_portion_code,
          coalesce(v_batch_number, format('receipt-%s', v_receipt.id)),
          v_supplier_name,
          p_delivery_date
        )
      )
    );

    insert into public.daily_stock (stock_date, portion_type_id, starting_quantity)
    values (p_delivery_date, v_direct_sellable_portion_id, v_direct_sellable_quantity)
    on conflict (stock_date, portion_type_id) do update
    set starting_quantity = public.daily_stock.starting_quantity + excluded.starting_quantity
    where public.daily_stock.reserved_quantity > 0
       or public.daily_stock.sold_quantity > 0
       or public.daily_stock.waste_quantity > 0
       or public.daily_stock.starting_quantity > 0;
  end if;

  return v_receipt;
end;
$$;

comment on function public.record_procurement_receipt(
  text, text, bigint, bigint, text, text, date, date, text, text, text, numeric, text, numeric, text, integer, integer
) is
  'Records protein, ingredient, or supply procurement receipts; fries, juice, yoghurt, and soda ingredient receipts can credit sellable stock directly.';

commit;
