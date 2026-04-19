begin;

-- Phase 17: ingredient intake for sides.
-- Purpose:
-- 1. Separate food-side receiving from both raw protein intake and non-food supply intake.
-- 2. Distinguish tracked inventory items as either ingredient inputs or operational supplies.
-- 3. Seed the first side-input items for fries and gonja in kilograms.

alter table public.inventory_items
  add column if not exists item_type text;

update public.inventory_items
set item_type = 'supply'
where item_type is null;

alter table public.inventory_items
  alter column item_type set default 'supply';

alter table public.inventory_items
  alter column item_type set not null;

alter table public.inventory_items
  drop constraint if exists inventory_items_item_type_chk;

alter table public.inventory_items
  add constraint inventory_items_item_type_chk check (item_type in ('ingredient', 'supply'));

create index if not exists inventory_items_type_active_name_idx
  on public.inventory_items (item_type, is_active, name);

comment on column public.inventory_items.item_type is
  'Operational classification of tracked inventory: ingredient inputs versus non-food supplies.';

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
  ('fries_kg', 'Fries input', 'kg', 'ingredient', 0, 0, true),
  ('gonja_kg', 'Gonja input', 'kg', 'ingredient', 0, 0, true)
on conflict (code) do update
set
  name = excluded.name,
  unit_name = excluded.unit_name,
  item_type = excluded.item_type,
  is_active = excluded.is_active,
  updated_at = now();

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_intake_type_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_intake_type_chk check (
    intake_type in ('protein', 'ingredient', 'supply')
  );

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_source_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_source_chk check (
    (intake_type = 'protein' and protein_code is not null and inventory_item_id is null) or
    (intake_type in ('ingredient', 'supply') and protein_code is null and inventory_item_id is not null)
  );

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
  v_supplier_default_abattoir_name text;
  v_unit_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_abattoir_name text := nullif(btrim(coalesce(p_abattoir_name, '')), '');
  v_vet_stamp_number text := nullif(btrim(coalesce(p_vet_stamp_number, '')), '');
  v_inspection_officer_name text := nullif(btrim(coalesce(p_inspection_officer_name, '')), '');
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
    select *
    into v_supplier
    from public.suppliers
    where id = p_supplier_id;

    if not found then
      raise exception 'Supplier % not found', p_supplier_id;
    end if;

    v_supplier_name := v_supplier.name;
    v_supplier_default_abattoir_name := v_supplier.default_abattoir_name;
  end if;

  if p_intake_type = 'protein' then
    if p_supplier_id is null then
      raise exception 'Supplier is required for protein receipts';
    end if;

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
      v_abattoir_name := nullif(btrim(coalesce(v_supplier_default_abattoir_name, '')), '');
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
    if v_supplier_name is not null then
      v_supplier_name := v_supplier_name;
    elsif nullif(btrim(coalesce(p_supplier_name, '')), '') is not null then
      v_supplier_name := btrim(p_supplier_name);
    else
      raise exception 'Supplier name is required';
    end if;

    select *
    into v_inventory_item
    from public.inventory_items
    where id = p_inventory_item_id
    for update;

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
    v_batch_number := null;
    v_abattoir_name := null;
    v_vet_stamp_number := null;
    v_inspection_officer_name := null;
  end if;

  insert into public.procurement_receipts (
    intake_type,
    protein_code,
    inventory_item_id,
    supplier_id,
    supplier_name,
    batch_number,
    delivery_date,
    butchered_on,
    abattoir_name,
    vet_stamp_number,
    inspection_officer_name,
    item_name,
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
    p_supplier_id,
    v_supplier_name,
    v_batch_number,
    p_delivery_date,
    p_butchered_on,
    v_abattoir_name,
    v_vet_stamp_number,
    v_inspection_officer_name,
    v_item_name,
    p_quantity_received,
    v_unit_name,
    p_unit_cost,
    v_note,
    p_allocated_to_halves,
    p_allocated_to_quarters
  )
  returning *
  into v_receipt;

  if p_intake_type in ('ingredient', 'supply') then
    perform public.apply_inventory_adjustment(
      v_inventory_item.id,
      p_quantity_received,
      'restock',
      coalesce(
        v_note,
        format('Procurement receipt from %s on %s', v_supplier_name, p_delivery_date)
      )
    );
  end if;

  return v_receipt;
end;
$$;

comment on function public.record_procurement_receipt(
  text,
  text,
  bigint,
  bigint,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  numeric,
  text,
  numeric,
  text,
  integer,
  integer
) is
  'Records protein, ingredient, or supply procurement receipts and posts non-protein intake into tracked inventory when applicable.';

commit;
