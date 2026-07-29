begin;

-- Phase 59: data-backed menu drink intake.
-- Purpose:
-- 1. Replace the hard-coded drink receipt allowlist with an explicit
--    inventory-item -> sellable-portion mapping.
-- 2. Preserve the existing litre/carton conversion rules.
-- 3. Automatically create a one-unit-to-one-portion intake option whenever a
--    menu item is created or moved into the Drinks category.
-- 4. Keep raw side ingredients on the existing tracked-inventory path.

alter table public.inventory_items
  add column if not exists direct_sellable_portion_type_id bigint
  references public.portion_types(id) on update cascade on delete restrict;

alter table public.inventory_items
  add column if not exists sellable_units_per_input numeric(12,4) not null default 1;

alter table public.inventory_items
  add column if not exists requires_whole_input boolean not null default false;

alter table public.inventory_items
  add column if not exists source_menu_item_id bigint
  references public.menu_items(id) on update cascade on delete set null;

alter table public.inventory_items
  drop constraint if exists inventory_items_sellable_units_per_input_chk;

alter table public.inventory_items
  add constraint inventory_items_sellable_units_per_input_chk check (
    sellable_units_per_input > 0
  );

with legacy_mapping (
  inventory_code,
  portion_code,
  sellable_units_per_input,
  requires_whole_input
) as (
  values
    ('fries_kg', 'fries_250g', 4::numeric, false),
    ('juice_litre', 'juice', 2::numeric, false),
    ('yoghurt_litre', 'yoghurt_500ml', 2::numeric, false),
    ('soda_carton', 'soda_350ml', 12::numeric, true),
    ('water_carton', 'water_500ml', 12::numeric, true)
)
update public.inventory_items as ii
set
  direct_sellable_portion_type_id = pt.id,
  sellable_units_per_input = mapping.sellable_units_per_input,
  requires_whole_input = mapping.requires_whole_input
from legacy_mapping as mapping
join public.portion_types as pt
  on pt.code = mapping.portion_code
where ii.code = mapping.inventory_code;

update public.inventory_items as ii
set source_menu_item_id = mi.id
from public.menu_items as mi
where ii.direct_sellable_portion_type_id = mi.portion_type_id
  and ii.source_menu_item_id is null;

create unique index if not exists inventory_items_direct_sellable_portion_idx
  on public.inventory_items (direct_sellable_portion_type_id)
  where direct_sellable_portion_type_id is not null;

create unique index if not exists inventory_items_source_menu_item_idx
  on public.inventory_items (source_menu_item_id)
  where source_menu_item_id is not null;

create or replace function public.ensure_menu_drink_intake_item(
  p_menu_item_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menu_item record;
  v_inventory_item_id bigint;
begin
  select mi.*, mc.code as category_code
  into v_menu_item
  from public.menu_items as mi
  join public.menu_categories as mc
    on mc.id = mi.menu_category_id
  where mi.id = p_menu_item_id;

  if not found or v_menu_item.category_code <> 'drinks' then
    return null;
  end if;

  select ii.id
  into v_inventory_item_id
  from public.inventory_items as ii
  where ii.direct_sellable_portion_type_id = v_menu_item.portion_type_id
  limit 1;

  if v_inventory_item_id is not null then
    update public.inventory_items
    set
      source_menu_item_id = coalesce(source_menu_item_id, v_menu_item.id),
      is_active = true
    where id = v_inventory_item_id;

    return v_inventory_item_id;
  end if;

  insert into public.inventory_items (
    code,
    name,
    unit_name,
    item_type,
    current_quantity,
    reorder_threshold,
    is_active,
    direct_sellable_portion_type_id,
    sellable_units_per_input,
    requires_whole_input,
    source_menu_item_id
  )
  values (
    format('menu_drink_%s', v_menu_item.id),
    format('%s intake (menu %s)', v_menu_item.name, v_menu_item.id),
    'unit',
    'ingredient',
    0,
    0,
    true,
    v_menu_item.portion_type_id,
    1,
    true,
    v_menu_item.id
  )
  on conflict (code) do update
  set
    direct_sellable_portion_type_id = excluded.direct_sellable_portion_type_id,
    sellable_units_per_input = excluded.sellable_units_per_input,
    requires_whole_input = excluded.requires_whole_input,
    source_menu_item_id = excluded.source_menu_item_id,
    is_active = true
  returning id
  into v_inventory_item_id;

  return v_inventory_item_id;
end;
$$;

revoke all on function public.ensure_menu_drink_intake_item(bigint)
from public, anon, authenticated;
grant execute on function public.ensure_menu_drink_intake_item(bigint)
to service_role;

create or replace function public.sync_menu_drink_intake_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_menu_drink_intake_item(new.id);
  return new;
end;
$$;

drop trigger if exists menu_items_sync_drink_intake on public.menu_items;
create trigger menu_items_sync_drink_intake
after insert or update of menu_category_id, portion_type_id, name
on public.menu_items
for each row
execute function public.sync_menu_drink_intake_item();

do $$
declare
  v_menu_item record;
begin
  for v_menu_item in
    select mi.id
    from public.menu_items as mi
    join public.menu_categories as mc
      on mc.id = mi.menu_category_id
    where mc.code = 'drinks'
    order by mi.id
  loop
    perform public.ensure_menu_drink_intake_item(v_menu_item.id);
  end loop;
end;
$$;

create or replace function public.record_direct_sellable_procurement_receipt(
  p_inventory_item_id bigint,
  p_supplier_id bigint default null,
  p_supplier_name text default null,
  p_batch_number text default null,
  p_delivery_date date default null,
  p_quantity_received numeric(12,2) default null,
  p_unit_cost numeric(12,2) default null,
  p_note text default null
)
returns public.procurement_receipts
language plpgsql
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_inventory_item public.inventory_items%rowtype;
  v_supplier public.suppliers%rowtype;
  v_portion_type public.portion_types%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_supplier_name text;
  v_item_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_sellable_quantity integer;
begin
  if p_delivery_date is null then
    raise exception 'Delivery date is required';
  end if;

  if p_quantity_received is null or p_quantity_received <= 0 then
    raise exception 'Quantity received must be greater than zero';
  end if;

  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Unit cost cannot be negative';
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

  if v_inventory_item.item_type <> 'ingredient' then
    raise exception 'Inventory item % is not configured as an ingredient item', p_inventory_item_id;
  end if;

  if not v_inventory_item.is_active then
    raise exception 'Inventory item % is inactive', p_inventory_item_id;
  end if;

  if v_inventory_item.direct_sellable_portion_type_id is null then
    raise exception 'Inventory item % is not mapped to a sellable portion', p_inventory_item_id;
  end if;

  if v_inventory_item.requires_whole_input
    and trunc(p_quantity_received) <> p_quantity_received then
    raise exception '% must be received as whole % units',
      v_inventory_item.name,
      v_inventory_item.unit_name;
  end if;

  select *
  into v_portion_type
  from public.portion_types
  where id = v_inventory_item.direct_sellable_portion_type_id
    and is_active = true;

  if not found then
    raise exception 'Mapped sellable portion for % is missing or inactive', v_inventory_item.name;
  end if;

  select coalesce(
    (
      select mi.name
      from public.menu_items as mi
      where mi.id = v_inventory_item.source_menu_item_id
    ),
    v_inventory_item.name
  )
  into v_item_name;

  v_sellable_quantity := floor(
    p_quantity_received * v_inventory_item.sellable_units_per_input
  )::integer;

  if v_sellable_quantity <= 0 then
    raise exception 'Receipt quantity is not enough to create one sellable portion for %',
      v_portion_type.code;
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
    'ingredient',
    null,
    v_inventory_item.id,
    p_supplier_id,
    v_supplier_name,
    v_batch_number,
    p_delivery_date,
    null,
    null,
    null,
    null,
    v_item_name,
    p_quantity_received,
    v_inventory_item.unit_name,
    p_unit_cost,
    v_note,
    0,
    0
  )
  returning *
  into v_receipt;

  insert into public.finished_stock (
    portion_type_id,
    current_quantity
  )
  values (
    v_portion_type.id,
    v_sellable_quantity
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
    v_portion_type.id,
    'adjustment',
    v_sellable_quantity,
    v_finished_stock.current_quantity,
    null,
    coalesce(
      v_note,
      format(
        'Direct sellable %s receipt %s from %s on %s',
        v_portion_type.code,
        coalesce(v_batch_number, format('receipt-%s', v_receipt.id)),
        v_supplier_name,
        p_delivery_date
      )
    )
  );

  insert into public.daily_stock (
    stock_date,
    portion_type_id,
    starting_quantity
  )
  values (
    p_delivery_date,
    v_portion_type.id,
    v_sellable_quantity
  )
  on conflict (stock_date, portion_type_id) do update
  set starting_quantity = public.daily_stock.starting_quantity + excluded.starting_quantity;

  return v_receipt;
end;
$$;

revoke all on function public.record_direct_sellable_procurement_receipt(
  bigint, bigint, text, text, date, numeric, numeric, text
) from public, anon, authenticated;
grant execute on function public.record_direct_sellable_procurement_receipt(
  bigint, bigint, text, text, date, numeric, numeric, text
) to service_role;

comment on column public.inventory_items.direct_sellable_portion_type_id is
  'Sellable finished-stock portion credited when this ingredient intake item is received.';

comment on column public.inventory_items.sellable_units_per_input is
  'Number of whole sellable portions credited per received input unit.';

comment on column public.inventory_items.requires_whole_input is
  'Requires received input quantities to be whole numbers, for example bottles, units, or cartons.';

comment on column public.inventory_items.source_menu_item_id is
  'Menu item that caused this Drinks-category intake option to be created automatically.';

comment on function public.ensure_menu_drink_intake_item(bigint) is
  'Ensures a Drinks-category menu item has an ingredient intake option mapped to its sellable portion.';

comment on function public.record_direct_sellable_procurement_receipt(
  bigint, bigint, text, text, date, numeric, numeric, text
) is
  'Records mapped sides/drinks intake and atomically credits finished stock and service-day stock.';

commit;
