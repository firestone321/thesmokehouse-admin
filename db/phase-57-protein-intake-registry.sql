begin;

-- Phase 57: data-backed protein intake items and processing mappings.
-- Purpose:
-- 1. Let approved admins add a new receivable protein without a code release.
-- 2. Map each raw protein item to the exact sellable portion(s) it may produce.
-- 3. Connect the existing Beef Oxtail 300g menu portion to receiving, processing,
--    finished stock, and today's sellable stock.
-- 4. Prevent a standard protein receipt from being credited more than once.

create table if not exists public.protein_intake_items (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null unique,
  default_unit_name text not null default 'kg',
  protein_id bigint not null references public.proteins(id) on update cascade on delete restrict,
  processing_mode text not null default 'standard_weight',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint protein_intake_items_code_format_chk check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint protein_intake_items_name_not_blank_chk check (btrim(name) <> ''),
  constraint protein_intake_items_unit_not_blank_chk check (btrim(default_unit_name) <> ''),
  constraint protein_intake_items_processing_mode_chk check (processing_mode in ('standard_weight', 'whole_bird'))
);

drop trigger if exists protein_intake_items_set_updated_at on public.protein_intake_items;
create trigger protein_intake_items_set_updated_at
before update on public.protein_intake_items
for each row execute function public.set_updated_at();

create table if not exists public.protein_intake_item_portions (
  protein_intake_item_id bigint not null references public.protein_intake_items(id) on update cascade on delete cascade,
  portion_type_id bigint not null references public.portion_types(id) on update cascade on delete restrict,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (protein_intake_item_id, portion_type_id)
);

create unique index if not exists protein_intake_item_portions_one_default_idx
  on public.protein_intake_item_portions (protein_intake_item_id)
  where is_default = true;

alter table public.protein_intake_items enable row level security;
alter table public.protein_intake_item_portions enable row level security;
revoke all on table public.protein_intake_items from public, anon, authenticated;
revoke all on table public.protein_intake_item_portions from public, anon, authenticated;
grant all on table public.protein_intake_items to service_role;
grant all on table public.protein_intake_item_portions to service_role;
grant usage, select on sequence public.protein_intake_items_id_seq to service_role;

insert into public.protein_intake_items (
  code,
  name,
  default_unit_name,
  protein_id,
  processing_mode,
  is_active
)
select seed.code, seed.name, seed.default_unit_name, p.id, seed.processing_mode, seed.is_active
from (
  values
    ('beef_ribs', 'Beef ribs', 'kg', 'beef', 'standard_weight', true),
    ('beef_chunks', 'Beef chunks', 'kg', 'beef', 'standard_weight', true),
    ('whole_chicken', 'Whole chicken', 'bird', 'chicken', 'whole_bird', true),
    ('goat_ribs', 'Goat ribs', 'kg', 'goat', 'standard_weight', true),
    ('goat_chunks', 'Goat chunks', 'kg', 'goat', 'standard_weight', true),
    ('beef', 'Beef', 'kg', 'beef', 'standard_weight', false),
    ('goat', 'Goat meat', 'kg', 'goat', 'standard_weight', false)
) as seed(code, name, default_unit_name, protein_code, processing_mode, is_active)
join public.proteins p on p.code = seed.protein_code
on conflict (code) do update
set
  name = excluded.name,
  default_unit_name = excluded.default_unit_name,
  protein_id = excluded.protein_id,
  processing_mode = excluded.processing_mode,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.protein_intake_item_portions (protein_intake_item_id, portion_type_id, is_default)
select pii.id, pt.id, mapping.is_default
from (
  values
    ('beef_ribs', 'beef_ribs_300g', true),
    ('beef_chunks', 'beef_chunks_300g', true),
    ('whole_chicken', 'chicken_half', true),
    ('whole_chicken', 'chicken_quarter', false),
    ('goat_ribs', 'goat_ribs_300g', true),
    ('goat_chunks', 'goat_chunks_300g', true),
    ('beef', 'beef_ribs_300g', true),
    ('beef', 'beef_chunks_300g', false),
    ('goat', 'goat_ribs_300g', true),
    ('goat', 'goat_chunks_300g', false)
) as mapping(item_code, portion_code, is_default)
join public.protein_intake_items pii on pii.code = mapping.item_code
join public.portion_types pt on pt.code = mapping.portion_code
on conflict (protein_intake_item_id, portion_type_id) do update
set is_default = excluded.is_default;

update public.portion_types pt
set protein_id = p.id
from public.proteins p
where pt.code = 'oxtail_portions'
  and p.code = 'beef'
  and (pt.protein_id is null or pt.protein_id = p.id);

insert into public.protein_intake_items (
  code,
  name,
  default_unit_name,
  protein_id,
  processing_mode,
  is_active
)
select 'beef_oxtail', 'Beef Oxtail', 'kg', p.id, 'standard_weight', true
from public.proteins p
where p.code = 'beef'
  and exists (select 1 from public.portion_types pt where pt.code = 'oxtail_portions')
on conflict (code) do update
set
  name = excluded.name,
  default_unit_name = excluded.default_unit_name,
  protein_id = excluded.protein_id,
  processing_mode = excluded.processing_mode,
  is_active = true,
  updated_at = now();

insert into public.protein_intake_item_portions (protein_intake_item_id, portion_type_id, is_default)
select pii.id, pt.id, true
from public.protein_intake_items pii
join public.portion_types pt on pt.code = 'oxtail_portions'
where pii.code = 'beef_oxtail'
on conflict (protein_intake_item_id, portion_type_id) do update
set is_default = true;

alter table public.procurement_receipts
  add column if not exists protein_intake_item_id bigint
  references public.protein_intake_items(id) on update cascade on delete restrict;

update public.procurement_receipts pr
set protein_intake_item_id = pii.id
from public.protein_intake_items pii
where pr.intake_type = 'protein'
  and pr.protein_code = pii.code
  and pr.protein_intake_item_id is distinct from pii.id;

create index if not exists procurement_receipts_protein_intake_item_idx
  on public.procurement_receipts (protein_intake_item_id, delivery_date desc);

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_protein_code_chk;

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_source_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_source_chk check (
    (
      intake_type = 'protein'
      and protein_code is not null
      and protein_intake_item_id is not null
      and inventory_item_id is null
    ) or (
      intake_type in ('ingredient', 'supply')
      and protein_code is null
      and protein_intake_item_id is null
      and inventory_item_id is not null
    )
  );

create or replace function public.create_protein_intake_item(
  p_code text,
  p_name text,
  p_default_unit_name text,
  p_protein_id bigint,
  p_portion_type_id bigint
)
returns table (
  id bigint,
  code text,
  name text,
  default_unit_name text,
  protein_id bigint,
  processing_mode text,
  portion_type_id bigint
)
language plpgsql
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_unit_name text := lower(btrim(coalesce(p_default_unit_name, '')));
  v_processing_mode text;
  v_protein public.proteins%rowtype;
  v_item public.protein_intake_items%rowtype;
  v_portion public.portion_types%rowtype;
begin
  if v_code !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Protein item code is invalid';
  end if;

  if v_name = '' then
    raise exception 'Protein item name is required';
  end if;

  select * into v_protein
  from public.proteins p
  where p.id = p_protein_id
    and p.is_active = true;

  if not found then
    raise exception 'Protein family % is missing or inactive', p_protein_id;
  end if;

  v_processing_mode := case when v_protein.code = 'chicken' then 'whole_bird' else 'standard_weight' end;

  if v_protein.code = 'chicken' and v_unit_name <> 'bird' then
    raise exception 'Chicken protein items must be received as whole birds';
  elsif v_protein.code <> 'chicken' and v_unit_name <> 'kg' then
    raise exception 'Non-chicken protein items must be received in kg';
  end if;

  select * into v_portion
  from public.portion_types pt
  where pt.id = p_portion_type_id
    and pt.is_active = true
  for update;

  if not found then
    raise exception 'Sellable portion % is missing or inactive', p_portion_type_id;
  end if;

  if v_portion.protein_id is not null and v_portion.protein_id <> p_protein_id then
    raise exception 'Sellable portion % belongs to a different protein family', p_portion_type_id;
  end if;

  update public.portion_types
  set protein_id = p_protein_id
  where public.portion_types.id = p_portion_type_id
    and public.portion_types.protein_id is null;

  select * into v_item
  from public.protein_intake_items pii
  where pii.code = v_code
  for update;

  if v_item.id is null then
    select * into v_item
    from public.protein_intake_items pii
    where lower(pii.name) = lower(v_name)
    limit 1
    for update;
  end if;

  if v_item.id is not null then
    if v_item.protein_id <> p_protein_id or v_item.processing_mode <> v_processing_mode then
      raise exception 'Protein item % already exists with a different family or processing mode', v_item.name;
    end if;

    update public.protein_intake_items
    set
      name = v_name,
      default_unit_name = v_unit_name,
      is_active = true
    where public.protein_intake_items.id = v_item.id
    returning * into v_item;
  else
    insert into public.protein_intake_items (
      code,
      name,
      default_unit_name,
      protein_id,
      processing_mode,
      is_active
    )
    values (v_code, v_name, v_unit_name, p_protein_id, v_processing_mode, true)
    returning * into v_item;
  end if;

  update public.protein_intake_item_portions
  set is_default = false
  where protein_intake_item_id = v_item.id
    and portion_type_id <> p_portion_type_id
    and is_default = true;

  insert into public.protein_intake_item_portions (
    protein_intake_item_id,
    portion_type_id,
    is_default
  )
  values (v_item.id, p_portion_type_id, true)
  on conflict (protein_intake_item_id, portion_type_id) do update
  set is_default = excluded.is_default;

  return query
  select
    v_item.id,
    v_item.code,
    v_item.name,
    v_item.default_unit_name,
    v_item.protein_id,
    v_item.processing_mode,
    p_portion_type_id;
end;
$$;

revoke all on function public.create_protein_intake_item(text, text, text, bigint, bigint)
from public, anon, authenticated;
grant execute on function public.create_protein_intake_item(text, text, text, bigint, bigint)
to service_role;

create or replace function public.record_protein_procurement_receipt(
  p_protein_intake_item_id bigint,
  p_supplier_id bigint,
  p_batch_number text,
  p_delivery_date date,
  p_butchered_on date,
  p_abattoir_name text,
  p_vet_stamp_number text,
  p_inspection_officer_name text,
  p_quantity_received numeric(12,2),
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
  v_item public.protein_intake_items%rowtype;
  v_supplier public.suppliers%rowtype;
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_abattoir_name text := nullif(btrim(coalesce(p_abattoir_name, '')), '');
  v_vet_stamp_number text := nullif(btrim(coalesce(p_vet_stamp_number, '')), '');
  v_inspection_officer_name text := nullif(btrim(coalesce(p_inspection_officer_name, '')), '');
  v_unit_name text := nullif(btrim(coalesce(p_unit_name, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_item
  from public.protein_intake_items pii
  where pii.id = p_protein_intake_item_id
    and pii.is_active = true;

  if not found then
    raise exception 'Protein intake item % is missing or inactive', p_protein_intake_item_id;
  end if;

  select * into v_supplier
  from public.suppliers s
  where s.id = p_supplier_id;

  if not found then
    raise exception 'Supplier % not found', p_supplier_id;
  end if;

  if p_delivery_date is null then
    raise exception 'Delivery date is required';
  end if;

  if p_butchered_on is null then
    raise exception 'Butchered date is required for protein receipts';
  end if;

  if p_butchered_on > p_delivery_date then
    raise exception 'Butchered date cannot be after delivery date';
  end if;

  if p_quantity_received is null or p_quantity_received <= 0 then
    raise exception 'Quantity received must be greater than zero';
  end if;

  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Unit cost cannot be negative';
  end if;

  if v_batch_number is null then
    raise exception 'Batch number is required for protein receipts';
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

  if v_unit_name is null then
    v_unit_name := v_item.default_unit_name;
  end if;

  if p_allocated_to_halves < 0 or p_allocated_to_quarters < 0 then
    raise exception 'Chicken allocations cannot be negative';
  end if;

  if v_item.processing_mode = 'whole_bird' then
    if trunc(p_quantity_received) <> p_quantity_received then
      raise exception 'Whole-bird quantity must be a whole number';
    end if;

    if p_allocated_to_halves + p_allocated_to_quarters > p_quantity_received then
      raise exception 'Chicken allocations cannot exceed whole birds received';
    end if;
  elsif p_allocated_to_halves <> 0 or p_allocated_to_quarters <> 0 then
    raise exception 'Chicken allocations are only allowed for whole-bird receipts';
  end if;

  insert into public.procurement_receipts (
    intake_type,
    protein_code,
    protein_intake_item_id,
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
    'protein',
    v_item.code,
    v_item.id,
    null,
    v_supplier.id,
    v_supplier.name,
    v_batch_number,
    p_delivery_date,
    p_butchered_on,
    v_abattoir_name,
    v_vet_stamp_number,
    v_inspection_officer_name,
    v_item.name,
    p_quantity_received,
    v_unit_name,
    p_unit_cost,
    v_note,
    p_allocated_to_halves,
    p_allocated_to_quarters
  )
  returning * into v_receipt;

  return v_receipt;
end;
$$;

revoke all on function public.record_protein_procurement_receipt(
  bigint, bigint, text, date, date, text, text, text, numeric, text, numeric, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_protein_procurement_receipt(
  bigint, bigint, text, date, date, text, text, text, numeric, text, numeric, text, integer, integer
) to service_role;

create or replace function public.process_procurement_receipt_to_finished_stock(
  p_procurement_receipt_id bigint,
  p_portion_type_id bigint,
  p_quantity_produced integer,
  p_post_roast_packed_weight_kg numeric(10,3) default null,
  p_note text default null
)
returns public.finished_stock
language plpgsql
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_intake_item public.protein_intake_items%rowtype;
  v_portion_type public.portion_types%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_batch public.processing_batches%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_post_roast_packed_weight_kg numeric(10,3) := p_post_roast_packed_weight_kg;
  v_yield_percent numeric(6,2) := null;
  v_service_date date := (now() at time zone 'Africa/Kampala')::date;
begin
  if p_quantity_produced is null or p_quantity_produced <= 0 then
    raise exception 'Quantity produced must be greater than zero';
  end if;

  if v_post_roast_packed_weight_kg is not null and v_post_roast_packed_weight_kg <= 0 then
    raise exception 'Post-roast packed weight must be greater than zero when provided';
  end if;

  select * into v_receipt
  from public.procurement_receipts pr
  where pr.id = p_procurement_receipt_id
  for update;

  if not found then
    raise exception 'Procurement receipt % not found', p_procurement_receipt_id;
  end if;

  if v_receipt.intake_type <> 'protein' then
    raise exception 'Only protein receipts can be processed into finished stock';
  end if;

  select * into v_intake_item
  from public.protein_intake_items pii
  where pii.id = v_receipt.protein_intake_item_id;

  if not found then
    raise exception 'Protein intake item is missing for receipt %', p_procurement_receipt_id;
  end if;

  if v_intake_item.processing_mode <> 'standard_weight' then
    raise exception 'Whole-bird receipts must be processed with the chicken allocation workflow';
  end if;

  if exists (
    select 1 from public.processing_batches pb
    where pb.procurement_receipt_id = p_procurement_receipt_id
  ) then
    raise exception 'Protein receipt % already has a completed processing batch', p_procurement_receipt_id;
  end if;

  if v_post_roast_packed_weight_kg is not null
    and v_receipt.quantity_received is not null
    and v_post_roast_packed_weight_kg > v_receipt.quantity_received then
    raise exception 'Post-roast packed weight cannot exceed raw receipt weight';
  end if;

  if v_post_roast_packed_weight_kg is not null
    and v_receipt.quantity_received is not null
    and v_receipt.quantity_received > 0 then
    v_yield_percent := round((v_post_roast_packed_weight_kg / v_receipt.quantity_received) * 100, 2);
  end if;

  select * into v_portion_type
  from public.portion_types pt
  where pt.id = p_portion_type_id
    and pt.is_active = true;

  if not found then
    raise exception 'Portion type % is missing or inactive', p_portion_type_id;
  end if;

  if not exists (
    select 1
    from public.protein_intake_item_portions piip
    where piip.protein_intake_item_id = v_intake_item.id
      and piip.portion_type_id = v_portion_type.id
  ) then
    raise exception 'Receipt item % cannot be processed into portion %', v_intake_item.name, v_portion_type.code;
  end if;

  insert into public.processing_batches (
    procurement_receipt_id,
    portion_type_id,
    quantity_produced,
    post_roast_packed_weight_kg,
    yield_percent,
    note
  )
  values (
    p_procurement_receipt_id,
    p_portion_type_id,
    p_quantity_produced,
    v_post_roast_packed_weight_kg,
    v_yield_percent,
    v_note
  )
  returning * into v_batch;

  insert into public.finished_stock (portion_type_id, current_quantity)
  values (p_portion_type_id, p_quantity_produced)
  on conflict (portion_type_id) do update
  set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
  returning * into v_finished_stock;

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

  insert into public.daily_stock (stock_date, portion_type_id, starting_quantity)
  values (v_service_date, p_portion_type_id, v_finished_stock.current_quantity)
  on conflict (stock_date, portion_type_id) do update
  set starting_quantity = public.daily_stock.starting_quantity + p_quantity_produced;

  return v_finished_stock;
end;
$$;

revoke all on function public.process_procurement_receipt_to_finished_stock(bigint, bigint, integer, numeric, text)
from public, anon, authenticated;
grant execute on function public.process_procurement_receipt_to_finished_stock(bigint, bigint, integer, numeric, text)
to service_role;

comment on table public.protein_intake_items is
  'Raw protein receipt definitions. These are intentionally separate from broad menu protein families.';

comment on table public.protein_intake_item_portions is
  'Explicit allowlist of sellable portions each raw protein intake item may produce.';

commit;
