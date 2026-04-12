begin;

-- Phase 12: split red meat cuts into ribs and chunks.
-- Purpose:
-- 1. Make future beef and goat resupplies cut-specific instead of generic.
-- 2. Replace the legacy goat chops sellable entry with goat chunks and add goat ribs.
-- 3. Keep legacy generic beef/goat receipts valid so old operational history still loads.

do $$
declare
  v_goat_protein_id bigint;
  v_clamcraft_box_id bigint;
  v_goat_chunks_portion_id bigint;
begin
  select id
  into v_goat_protein_id
  from public.proteins
  where code = 'goat';

  select id
  into v_clamcraft_box_id
  from public.packaging_types
  where code = 'clamcraft_box';

  select id
  into v_goat_chunks_portion_id
  from public.portion_types
  where code = 'goat_chunks_350g';

  if v_goat_chunks_portion_id is null then
    select id
    into v_goat_chunks_portion_id
    from public.portion_types
    where code = 'goat_chops';

    if v_goat_chunks_portion_id is not null then
      update public.portion_types
      set
        code = 'goat_chunks_350g',
        name = 'Goat chunks',
        portion_label = '350g',
        sort_order = 6
      where id = v_goat_chunks_portion_id;
    else
      insert into public.portion_types (
        code,
        protein_id,
        packaging_type_id,
        name,
        portion_label,
        sort_order
      )
      values (
        'goat_chunks_350g',
        v_goat_protein_id,
        v_clamcraft_box_id,
        'Goat chunks',
        '350g',
        6
      )
      returning id
      into v_goat_chunks_portion_id;
    end if;
  else
    update public.portion_types
    set
      name = 'Goat chunks',
      portion_label = '350g',
      sort_order = 6
    where id = v_goat_chunks_portion_id;
  end if;

  insert into public.portion_types (
    code,
    protein_id,
    packaging_type_id,
    name,
    portion_label,
    sort_order
  )
  select
    'goat_ribs_350g',
    v_goat_protein_id,
    v_clamcraft_box_id,
    'Goat ribs',
    '350g',
    5
  where not exists (
    select 1
    from public.portion_types
    where code = 'goat_ribs_350g'
  );

  update public.portion_types
  set
    name = 'Goat ribs',
    portion_label = '350g',
    sort_order = 5
  where code = 'goat_ribs_350g';

  update public.portion_types
  set sort_order = 7
  where code = 'juice' and sort_order < 7;
end;
$$;

do $$
declare
  v_goat_category_id bigint;
  v_goat_chunks_portion_id bigint;
  v_goat_ribs_portion_id bigint;
  v_existing_goat_chunks_menu_id bigint;
begin
  select id
  into v_goat_category_id
  from public.menu_categories
  where code = 'goat';

  select id
  into v_goat_chunks_portion_id
  from public.portion_types
  where code = 'goat_chunks_350g';

  select id
  into v_goat_ribs_portion_id
  from public.portion_types
  where code = 'goat_ribs_350g';

  select id
  into v_existing_goat_chunks_menu_id
  from public.menu_items
  where code = 'goat_chunks_350g';

  if v_existing_goat_chunks_menu_id is null then
    update public.menu_items
    set
      code = 'goat_chunks_350g',
      portion_type_id = v_goat_chunks_portion_id,
      name = 'Goat chunks',
      description = 'Packed goat chunks portion.',
      prep_type = 'packed',
      sort_order = 6,
      updated_at = now()
    where code = 'goat_chops';
  else
    update public.menu_items
    set
      portion_type_id = v_goat_chunks_portion_id,
      name = 'Goat chunks',
      description = 'Packed goat chunks portion.',
      prep_type = 'packed',
      sort_order = 6,
      updated_at = now()
    where id = v_existing_goat_chunks_menu_id;
  end if;

  insert into public.menu_items (
    code,
    menu_category_id,
    portion_type_id,
    name,
    description,
    base_price,
    prep_type,
    is_active,
    is_available_today,
    sort_order
  )
  select
    'goat_ribs_350g',
    v_goat_category_id,
    v_goat_ribs_portion_id,
    'Goat ribs',
    'Smoked goat ribs portion.',
    0,
    'smoked',
    false,
    false,
    5
  where v_goat_category_id is not null
    and v_goat_ribs_portion_id is not null
    and not exists (
      select 1
      from public.menu_items
      where code = 'goat_ribs_350g'
    );

  update public.menu_items
  set
    name = 'Goat ribs',
    description = 'Smoked goat ribs portion.',
    prep_type = 'smoked',
    sort_order = 5,
    updated_at = now()
  where code = 'goat_ribs_350g';

  update public.menu_items
  set sort_order = 7,
      updated_at = now()
  where code = 'juice' and sort_order < 7;
end;
$$;

insert into public.menu_item_components (
  menu_item_id,
  inventory_item_id,
  quantity_required
)
select
  mi.id,
  ii.id,
  1
from public.menu_items mi
join public.inventory_items ii
  on ii.code = 'clamcraft_box_unit'
where mi.code in ('goat_ribs_350g', 'goat_chunks_350g')
on conflict (menu_item_id, inventory_item_id) do update
set
  quantity_required = excluded.quantity_required;

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_protein_code_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_protein_code_chk check (
    protein_code is null or protein_code in (
      'beef_ribs',
      'beef_chunks',
      'whole_chicken',
      'goat_ribs',
      'goat_chunks',
      'beef',
      'goat'
    )
  );

create or replace function public.record_procurement_receipt(
  p_intake_type text,
  p_protein_code text default null,
  p_inventory_item_id bigint default null,
  p_supplier_name text default null,
  p_delivery_date date default null,
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
  v_item_name text;
  v_unit_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_intake_type not in ('protein', 'supply') then
    raise exception 'Invalid procurement intake type: %', p_intake_type;
  end if;

  if nullif(btrim(coalesce(p_supplier_name, '')), '') is null then
    raise exception 'Supplier name is required';
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

  if p_intake_type = 'protein' then
    if p_protein_code not in (
      'beef_ribs',
      'beef_chunks',
      'whole_chicken',
      'goat_ribs',
      'goat_chunks',
      'beef',
      'goat'
    ) then
      raise exception 'Invalid protein procurement code: %', p_protein_code;
    end if;

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
      v_unit_name := case p_protein_code
        when 'beef_ribs' then 'kg'
        when 'beef_chunks' then 'kg'
        when 'whole_chicken' then 'bird'
        when 'goat_ribs' then 'kg'
        when 'goat_chunks' then 'kg'
        when 'beef' then 'kg'
        when 'goat' then 'kg'
      end;
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
    select *
    into v_inventory_item
    from public.inventory_items
    where id = p_inventory_item_id
    for update;

    if not found then
      raise exception 'Inventory item % not found', p_inventory_item_id;
    end if;

    v_item_name := v_inventory_item.name;
    v_unit_name := v_inventory_item.unit_name;
    p_protein_code := null;
    p_allocated_to_halves := 0;
    p_allocated_to_quarters := 0;
  end if;

  insert into public.procurement_receipts (
    intake_type,
    protein_code,
    inventory_item_id,
    item_name,
    supplier_name,
    delivery_date,
    quantity_received,
    unit_name,
    unit_cost,
    note,
    allocated_to_halves,
    allocated_to_quarters
  )
  values (
    p_intake_type,
    p_protein_code,
    p_inventory_item_id,
    v_item_name,
    btrim(p_supplier_name),
    p_delivery_date,
    p_quantity_received,
    v_unit_name,
    p_unit_cost,
    v_note,
    p_allocated_to_halves,
    p_allocated_to_quarters
  )
  returning *
  into v_receipt;

  if p_intake_type = 'supply' then
    perform public.apply_inventory_adjustment(
      v_inventory_item.id,
      p_quantity_received,
      'restock',
      coalesce(
        v_note,
        format('Procurement receipt from %s on %s', btrim(p_supplier_name), p_delivery_date)
      )
    );
  end if;

  return v_receipt;
end;
$$;

create or replace function public.process_procurement_receipt_to_finished_stock(
  p_procurement_receipt_id bigint,
  p_portion_type_id bigint,
  p_quantity_produced integer,
  p_note text default null
)
returns public.finished_stock
language plpgsql
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_portion_type public.portion_types%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_batch public.processing_batches%rowtype;
  v_receipt_protein_code text;
  v_portion_protein_code text;
  v_allowed integer;
  v_already_processed integer := 0;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_quantity_produced is null or p_quantity_produced <= 0 then
    raise exception 'Quantity produced must be greater than zero';
  end if;

  select *
  into v_receipt
  from public.procurement_receipts
  where id = p_procurement_receipt_id
  for update;

  if not found then
    raise exception 'Procurement receipt % not found', p_procurement_receipt_id;
  end if;

  if v_receipt.intake_type <> 'protein' then
    raise exception 'Only protein receipts can be processed into finished stock';
  end if;

  select pt.*
  into v_portion_type
  from public.portion_types pt
  where pt.id = p_portion_type_id;

  if not found then
    raise exception 'Portion type % not found', p_portion_type_id;
  end if;

  if not v_portion_type.is_active then
    raise exception 'Portion type % is not active', p_portion_type_id;
  end if;

  select pr.code
  into v_portion_protein_code
  from public.proteins pr
  where pr.id = v_portion_type.protein_id;

  v_receipt_protein_code := case
    when v_receipt.protein_code = 'whole_chicken' then 'chicken'
    when v_receipt.protein_code in ('beef_ribs', 'beef_chunks') then 'beef'
    when v_receipt.protein_code in ('goat_ribs', 'goat_chunks') then 'goat'
    else v_receipt.protein_code
  end;

  if v_receipt_protein_code is distinct from v_portion_protein_code then
    raise exception 'Receipt protein % cannot be processed into portion %', v_receipt.protein_code, v_portion_type.code;
  end if;

  if v_receipt.protein_code = 'beef_ribs' and v_portion_type.code <> 'beef_ribs_350g' then
    raise exception 'Beef ribs receipts can only be processed into beef ribs portions';
  end if;

  if v_receipt.protein_code = 'beef_chunks' and v_portion_type.code <> 'beef_chunks_350g' then
    raise exception 'Beef chunks receipts can only be processed into beef chunks portions';
  end if;

  if v_receipt.protein_code = 'goat_ribs' and v_portion_type.code <> 'goat_ribs_350g' then
    raise exception 'Goat ribs receipts can only be processed into goat ribs portions';
  end if;

  if v_receipt.protein_code = 'goat_chunks' and v_portion_type.code <> 'goat_chunks_350g' then
    raise exception 'Goat chunks receipts can only be processed into goat chunks portions';
  end if;

  if v_receipt.protein_code = 'whole_chicken' then
    if v_portion_type.code not in ('chicken_half', 'chicken_quarter') then
      raise exception 'Whole chicken receipts can only be processed into chicken half or chicken quarter portions';
    end if;

    select coalesce(sum(pb.quantity_produced), 0)
    into v_already_processed
    from public.processing_batches pb
    where pb.procurement_receipt_id = p_procurement_receipt_id
      and pb.portion_type_id = p_portion_type_id;

    if v_receipt.allocated_to_halves > 0 or v_receipt.allocated_to_quarters > 0 then
      if v_portion_type.code = 'chicken_half' then
        v_allowed := v_receipt.allocated_to_halves * 2;
      else
        v_allowed := v_receipt.allocated_to_quarters * 4;
      end if;

      if v_already_processed + p_quantity_produced > v_allowed then
        raise exception 'Processing % would exceed the planned chicken yield for receipt %', p_quantity_produced, p_procurement_receipt_id;
      end if;
    end if;
  end if;

  insert into public.processing_batches (
    procurement_receipt_id,
    portion_type_id,
    quantity_produced,
    note
  )
  values (
    p_procurement_receipt_id,
    p_portion_type_id,
    p_quantity_produced,
    v_note
  )
  returning *
  into v_batch;

  insert into public.finished_stock (
    portion_type_id,
    current_quantity
  )
  values (
    p_portion_type_id,
    p_quantity_produced
  )
  on conflict (portion_type_id) do update
  set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
  returning *
  into v_finished_stock;

  insert into public.finished_stock_movements (
    portion_type_id,
    movement_type,
    quantity_delta,
    resulting_quantity,
    processing_batch_id,
    note
  )
  values (
    p_portion_type_id,
    'production',
    p_quantity_produced,
    v_finished_stock.current_quantity,
    v_batch.id,
    coalesce(
      v_note,
      format('Processed from procurement receipt %s', p_procurement_receipt_id)
    )
  );

  return v_finished_stock;
end;
$$;

commit;
