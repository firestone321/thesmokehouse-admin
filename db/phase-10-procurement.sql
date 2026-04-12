begin;

-- Phase 10: procurement receipts.
-- Purpose:
-- 1. Record protein deliveries separately from daily sellable stock.
-- 2. Record supply receipts as an operational intake flow.
-- 3. Keep chicken yield planning visible without turning all theoretical yield
--    into live sellable stock automatically.

create table if not exists public.procurement_receipts (
  id bigint generated always as identity primary key,
  intake_type text not null,
  protein_code text,
  inventory_item_id bigint references public.inventory_items(id) on update cascade on delete restrict,
  item_name text not null,
  supplier_name text not null,
  delivery_date date not null,
  quantity_received numeric(12,2) not null,
  unit_name text not null,
  unit_cost numeric(12,2),
  note text,
  allocated_to_halves integer not null default 0,
  allocated_to_quarters integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_receipts_intake_type_chk check (intake_type in ('protein', 'supply')),
  constraint procurement_receipts_protein_code_chk check (
    protein_code is null or protein_code in (
      'beef_ribs',
      'beef_chunks',
      'whole_chicken',
      'goat_ribs',
      'goat_chunks',
      'beef',
      'goat'
    )
  ),
  constraint procurement_receipts_item_name_not_blank_chk check (btrim(item_name) <> ''),
  constraint procurement_receipts_supplier_name_not_blank_chk check (btrim(supplier_name) <> ''),
  constraint procurement_receipts_quantity_received_chk check (quantity_received > 0),
  constraint procurement_receipts_unit_name_not_blank_chk check (btrim(unit_name) <> ''),
  constraint procurement_receipts_unit_cost_chk check (unit_cost is null or unit_cost >= 0),
  constraint procurement_receipts_allocated_to_halves_chk check (allocated_to_halves >= 0),
  constraint procurement_receipts_allocated_to_quarters_chk check (allocated_to_quarters >= 0),
  constraint procurement_receipts_source_chk check (
    (intake_type = 'protein' and protein_code is not null and inventory_item_id is null) or
    (intake_type = 'supply' and protein_code is null and inventory_item_id is not null)
  )
);

create index if not exists procurement_receipts_delivery_date_idx
  on public.procurement_receipts (delivery_date desc, created_at desc);

create index if not exists procurement_receipts_type_created_idx
  on public.procurement_receipts (intake_type, created_at desc);

drop trigger if exists procurement_receipts_set_updated_at on public.procurement_receipts;
create trigger procurement_receipts_set_updated_at
before update on public.procurement_receipts
for each row
execute function public.set_updated_at();

comment on table public.procurement_receipts is
  'Operational receipt log for protein deliveries and tracked supply intake.';

comment on column public.procurement_receipts.allocated_to_halves is
  'Whole chickens planned for half portions. This does not create daily sellable stock automatically.';

comment on column public.procurement_receipts.allocated_to_quarters is
  'Whole chickens planned for quarter portions. This does not create daily sellable stock automatically.';

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

comment on function public.record_procurement_receipt(
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
) is
  'Records a procurement receipt and posts supply intake into tracked inventory when applicable.';

commit;
