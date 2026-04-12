begin;

-- Phase 13: supplier traceability and side portions.
-- Purpose:
-- 1. Add supplier master records for procurement workflows.
-- 2. Extend meat receipts with supplier and batch traceability fields.
-- 3. Add sellable side portions for fries and gonja.
-- 4. Change beef chunks from 350g to 300g without breaking existing stock rows.

create table if not exists public.suppliers (
  id bigint generated always as identity primary key,
  name text not null unique,
  phone_number text,
  license_number text,
  supplier_type text not null default 'protein',
  default_abattoir_name text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_not_blank_chk check (btrim(name) <> ''),
  constraint suppliers_phone_number_not_blank_chk check (
    phone_number is null or btrim(phone_number) <> ''
  ),
  constraint suppliers_license_number_not_blank_chk check (
    license_number is null or btrim(license_number) <> ''
  ),
  constraint suppliers_supplier_type_chk check (supplier_type in ('protein', 'supply', 'mixed')),
  constraint suppliers_default_abattoir_name_not_blank_chk check (
    default_abattoir_name is null or btrim(default_abattoir_name) <> ''
  )
);

create index if not exists suppliers_type_active_name_idx
  on public.suppliers (supplier_type, is_active, name);

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
before update on public.suppliers
for each row
execute function public.set_updated_at();

comment on table public.suppliers is
  'Supplier master records used by procurement intake and meat traceability workflows.';

comment on column public.suppliers.default_abattoir_name is
  'Operational default used to prefill meat intake traceability when the supplier normally uses one abattoir.';

alter table public.procurement_receipts
  add column if not exists supplier_id bigint references public.suppliers(id) on update cascade on delete restrict;

alter table public.procurement_receipts
  add column if not exists batch_number text;

alter table public.procurement_receipts
  add column if not exists butchered_on date;

alter table public.procurement_receipts
  add column if not exists abattoir_name text;

alter table public.procurement_receipts
  add column if not exists vet_stamp_number text;

alter table public.procurement_receipts
  add column if not exists inspection_officer_name text;

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_batch_number_not_blank_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_batch_number_not_blank_chk check (
    batch_number is null or btrim(batch_number) <> ''
  );

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_abattoir_name_not_blank_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_abattoir_name_not_blank_chk check (
    abattoir_name is null or btrim(abattoir_name) <> ''
  );

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_vet_stamp_number_not_blank_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_vet_stamp_number_not_blank_chk check (
    vet_stamp_number is null or btrim(vet_stamp_number) <> ''
  );

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_inspection_officer_name_not_blank_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_inspection_officer_name_not_blank_chk check (
    inspection_officer_name is null or btrim(inspection_officer_name) <> ''
  );

create unique index if not exists procurement_receipts_batch_number_key
  on public.procurement_receipts (batch_number)
  where batch_number is not null;

create index if not exists procurement_receipts_supplier_delivery_idx
  on public.procurement_receipts (supplier_id, delivery_date desc, created_at desc);

comment on column public.procurement_receipts.supplier_id is
  'Optional supplier master record for the receipt. supplier_name keeps the historical snapshot used at receipt time.';

comment on column public.procurement_receipts.batch_number is
  'Traceability batch identifier used to follow received meat through processing and eventual sale windows.';

comment on column public.procurement_receipts.butchered_on is
  'Date the source animal was butchered, when known for protein intake traceability.';

comment on column public.procurement_receipts.abattoir_name is
  'Abattoir recorded for protein receipts.';

comment on column public.procurement_receipts.vet_stamp_number is
  'Vet stamp or meat inspection stamp reference captured on receipt.';

comment on column public.procurement_receipts.inspection_officer_name is
  'Inspection officer name captured during meat receiving.';

insert into public.menu_categories (code, name, sort_order, is_active)
values
  ('sides', 'Sides', 4, true)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

update public.menu_categories
set
  sort_order = 5,
  updated_at = now()
where code = 'drinks' and sort_order < 5;

do $$
declare
  v_beef_protein_id bigint;
  v_clamcraft_box_id bigint;
  v_butcher_paper_id bigint;
  v_beef_chunks_portion_id bigint;
begin
  select id
  into v_beef_protein_id
  from public.proteins
  where code = 'beef';

  select id
  into v_clamcraft_box_id
  from public.packaging_types
  where code = 'clamcraft_box';

  select id
  into v_butcher_paper_id
  from public.packaging_types
  where code = 'butcher_paper';

  select id
  into v_beef_chunks_portion_id
  from public.portion_types
  where code = 'beef_chunks_300g';

  if v_beef_chunks_portion_id is null then
    select id
    into v_beef_chunks_portion_id
    from public.portion_types
    where code = 'beef_chunks_350g';

    if v_beef_chunks_portion_id is not null then
      update public.portion_types
      set
        code = 'beef_chunks_300g',
        protein_id = v_beef_protein_id,
        packaging_type_id = v_butcher_paper_id,
        name = 'Beef chunks',
        portion_label = '300g',
        sort_order = 2
      where id = v_beef_chunks_portion_id;
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
        'beef_chunks_300g',
        v_beef_protein_id,
        v_butcher_paper_id,
        'Beef chunks',
        '300g',
        2
      )
      returning id
      into v_beef_chunks_portion_id;
    end if;
  else
    update public.portion_types
    set
      protein_id = v_beef_protein_id,
      packaging_type_id = v_butcher_paper_id,
      name = 'Beef chunks',
      portion_label = '300g',
      sort_order = 2
    where id = v_beef_chunks_portion_id;
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
    'fries_250g',
    null,
    v_clamcraft_box_id,
    'Fries',
    '250g',
    7
  where not exists (
    select 1
    from public.portion_types
    where code = 'fries_250g'
  );

  update public.portion_types
  set
    packaging_type_id = v_clamcraft_box_id,
    name = 'Fries',
    portion_label = '250g',
    sort_order = 7
  where code = 'fries_250g';

  insert into public.portion_types (
    code,
    protein_id,
    packaging_type_id,
    name,
    portion_label,
    sort_order
  )
  select
    'gonja_250g',
    null,
    v_clamcraft_box_id,
    'Gonja',
    '250g',
    8
  where not exists (
    select 1
    from public.portion_types
    where code = 'gonja_250g'
  );

  update public.portion_types
  set
    packaging_type_id = v_clamcraft_box_id,
    name = 'Gonja',
    portion_label = '250g',
    sort_order = 8
  where code = 'gonja_250g';

  update public.portion_types
  set sort_order = 9
  where code = 'juice' and sort_order < 9;
end;
$$;

do $$
declare
  v_beef_category_id bigint;
  v_sides_category_id bigint;
  v_beef_chunks_portion_id bigint;
  v_fries_portion_id bigint;
  v_gonja_portion_id bigint;
  v_existing_beef_chunks_menu_id bigint;
begin
  select id
  into v_beef_category_id
  from public.menu_categories
  where code = 'beef';

  select id
  into v_sides_category_id
  from public.menu_categories
  where code = 'sides';

  select id
  into v_beef_chunks_portion_id
  from public.portion_types
  where code = 'beef_chunks_300g';

  select id
  into v_fries_portion_id
  from public.portion_types
  where code = 'fries_250g';

  select id
  into v_gonja_portion_id
  from public.portion_types
  where code = 'gonja_250g';

  select id
  into v_existing_beef_chunks_menu_id
  from public.menu_items
  where code = 'beef_chunks_300g';

  if v_existing_beef_chunks_menu_id is null then
    update public.menu_items
    set
      code = 'beef_chunks_300g',
      portion_type_id = v_beef_chunks_portion_id,
      name = 'Beef chunks',
      description = 'Packed beef chunks portion.',
      prep_type = 'packed',
      sort_order = 2,
      updated_at = now()
    where code = 'beef_chunks_350g';
  else
    update public.menu_items
    set
      portion_type_id = coalesce(v_beef_chunks_portion_id, portion_type_id),
      name = 'Beef chunks',
      description = 'Packed beef chunks portion.',
      prep_type = 'packed',
      sort_order = 2,
      updated_at = now()
    where id = v_existing_beef_chunks_menu_id;
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
    'fries_250g',
    v_sides_category_id,
    v_fries_portion_id,
    'Fries',
    'Boxed fries portion.',
    0,
    'packed',
    false,
    false,
    7
  where v_sides_category_id is not null
    and v_fries_portion_id is not null
    and not exists (
      select 1
      from public.menu_items
      where code = 'fries_250g'
    );

  update public.menu_items
  set
    menu_category_id = coalesce(v_sides_category_id, menu_category_id),
    portion_type_id = coalesce(v_fries_portion_id, portion_type_id),
    name = 'Fries',
    description = 'Boxed fries portion.',
    prep_type = 'packed',
    sort_order = 7,
    updated_at = now()
  where code = 'fries_250g';

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
    'gonja_250g',
    v_sides_category_id,
    v_gonja_portion_id,
    'Gonja',
    'Boxed gonja portion.',
    0,
    'packed',
    false,
    false,
    8
  where v_sides_category_id is not null
    and v_gonja_portion_id is not null
    and not exists (
      select 1
      from public.menu_items
      where code = 'gonja_250g'
    );

  update public.menu_items
  set
    menu_category_id = coalesce(v_sides_category_id, menu_category_id),
    portion_type_id = coalesce(v_gonja_portion_id, portion_type_id),
    name = 'Gonja',
    description = 'Boxed gonja portion.',
    prep_type = 'packed',
    sort_order = 8,
    updated_at = now()
  where code = 'gonja_250g';

  update public.menu_items
  set sort_order = 9,
      updated_at = now()
  where code = 'juice' and sort_order < 9;
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
  on ii.code = case
    when mi.code = 'beef_chunks_300g' then 'butcher_paper_sheet'
    when mi.code in ('fries_250g', 'gonja_250g') then 'clamcraft_box_unit'
  end
where mi.code in ('beef_chunks_300g', 'fries_250g', 'gonja_250g')
on conflict (menu_item_id, inventory_item_id) do update
set
  quantity_required = excluded.quantity_required;

drop function if exists public.record_procurement_receipt(
  text,
  text,
  bigint,
  text,
  date,
  numeric,
  text,
  numeric,
  text,
  integer,
  integer
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
  v_unit_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_abattoir_name text := nullif(btrim(coalesce(p_abattoir_name, '')), '');
  v_vet_stamp_number text := nullif(btrim(coalesce(p_vet_stamp_number, '')), '');
  v_inspection_officer_name text := nullif(btrim(coalesce(p_inspection_officer_name, '')), '');
begin
  if p_intake_type not in ('protein', 'supply') then
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
    if v_supplier.name is not null then
      v_supplier_name := v_supplier.name;
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

  if p_intake_type = 'supply' then
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
  'Records a procurement receipt, enforcing meat traceability fields for protein intake and posting supply intake into tracked inventory when applicable.';

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

  if v_receipt.protein_code = 'beef_chunks' and v_portion_type.code <> 'beef_chunks_300g' then
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
      case
        when v_receipt.batch_number is not null then
          format('Processed from batch %s (receipt %s)', v_receipt.batch_number, p_procurement_receipt_id)
        else
          format('Processed from procurement receipt %s', p_procurement_receipt_id)
      end
    )
  );

  return v_finished_stock;
end;
$$;

commit;
