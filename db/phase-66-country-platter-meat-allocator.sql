begin;

-- Phase 65: Country Platter meat allocation.
--
-- The Country Platter is a fixed package. Four cuts use dedicated platter
-- portions because their pack sizes differ from their standalone equivalents.
-- Chicken half and beef chunks keep using their existing standard portions.

alter table public.processing_batches
  add column if not exists trim_weight_kg numeric(10,3) not null default 0;

alter table public.processing_batches
  drop constraint if exists processing_batches_trim_weight_kg_chk;

alter table public.processing_batches
  add constraint processing_batches_trim_weight_kg_chk
  check (trim_weight_kg >= 0);

create table if not exists public.menu_item_stock_requirements (
  menu_item_id bigint not null references public.menu_items(id) on update cascade on delete cascade,
  portion_type_id bigint not null references public.portion_types(id) on update cascade on delete restrict,
  units_per_menu_item integer not null default 1 check (units_per_menu_item > 0),
  created_at timestamptz not null default now(),
  primary key (menu_item_id, portion_type_id)
);

alter table public.menu_item_stock_requirements enable row level security;
revoke all on public.menu_item_stock_requirements from public, anon, authenticated;
grant all on public.menu_item_stock_requirements to service_role;

with seed(code, name, portion_label, standalone_portion_code) as (
  values
    ('country_platter_beef_ribs', 'Country Platter beef ribs', '400g', 'beef_ribs'),
    ('country_platter_oxtail', 'Country Platter oxtail', '300g', 'oxtail_portion'),
    ('country_platter_goat_ribs', 'Country Platter goat ribs', '350g', 'goat_rib_portions'),
    ('country_platter_goat_chops', 'Country Platter goat chops', '300g', 'goat_chunks_portions')
)
insert into public.portion_types (
  code,
  protein_id,
  packaging_type_id,
  name,
  portion_label,
  sort_order,
  is_active
)
select
  seed.code,
  standalone.protein_id,
  standalone.packaging_type_id,
  seed.name,
  seed.portion_label,
  standalone.sort_order,
  true
from seed
join public.portion_types as standalone
  on standalone.code = seed.standalone_portion_code
on conflict (code) do update
set
  protein_id = excluded.protein_id,
  packaging_type_id = excluded.packaging_type_id,
  name = excluded.name,
  portion_label = excluded.portion_label,
  is_active = true;

insert into public.protein_intake_item_portions (
  protein_intake_item_id,
  portion_type_id,
  is_default
)
select
  intake.id,
  platter_portion.id,
  false
from (
  values
    ('beef_ribs', 'country_platter_beef_ribs'),
    ('beef_oxtail', 'country_platter_oxtail'),
    ('goat_ribs', 'country_platter_goat_ribs'),
    ('goat_chunks', 'country_platter_goat_chops')
) as mapping(intake_code, portion_code)
join public.protein_intake_items as intake
  on intake.code = mapping.intake_code
join public.portion_types as platter_portion
  on platter_portion.code = mapping.portion_code
on conflict (protein_intake_item_id, portion_type_id) do update
set is_default = false;

-- 3.8kg covers all food portions and excludes sauces and the 2-litre soda.
update public.portion_types
set portion_label = '3800g'
where code = 'platter_portions';

insert into public.menu_item_stock_requirements (
  menu_item_id,
  portion_type_id,
  units_per_menu_item
)
select
  menu_item.id,
  portion_type.id,
  1
from (
  values
    ('country_platter_beef_ribs'),
    ('beef_chunks_portion'),
    ('country_platter_oxtail'),
    ('country_platter_goat_ribs'),
    ('country_platter_goat_chops'),
    ('chicken_half')
) as requirement(portion_code)
join public.menu_items as menu_item
  on menu_item.code = 'country_plater_for_four'
join public.portion_types as portion_type
  on portion_type.code = requirement.portion_code
on conflict (menu_item_id, portion_type_id) do update
set units_per_menu_item = excluded.units_per_menu_item;

-- Reuses the stock source machinery used by shared portions.  Menu items with
-- no explicit requirements retain their current single-portion behaviour.
create or replace function public.get_order_stock_requirements(p_order_id bigint)
returns table (
  portion_type_id bigint,
  quantity_required integer
)
language sql
stable
as $$
  select
    coalesce(requirement.portion_type_id, source_portion.id) as portion_type_id,
    sum(
      order_item.quantity * coalesce(
        requirement.units_per_menu_item,
        menu_portion.stock_source_units_per_serving,
        1
      )
    )::integer as quantity_required
  from public.order_items as order_item
  join public.menu_items as menu_item
    on menu_item.id = order_item.menu_item_id
  join public.portion_types as menu_portion
    on menu_portion.id = menu_item.portion_type_id
  left join public.menu_item_stock_requirements as requirement
    on requirement.menu_item_id = menu_item.id
  left join public.portion_types as source_portion
    on source_portion.id = coalesce(
      menu_portion.stock_source_portion_type_id,
      menu_item.portion_type_id
    )
  where order_item.order_id = p_order_id
  group by coalesce(requirement.portion_type_id, source_portion.id)
  order by coalesce(requirement.portion_type_id, source_portion.id);
$$;

create or replace function public.process_standard_weight_meat_receipt_allocation(
  p_procurement_receipt_id bigint,
  p_post_roast_packed_weight_kg numeric(10,3),
  p_country_platter_weight_kg numeric(10,3),
  p_note text default null
)
returns void
language plpgsql
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_intake_item public.protein_intake_items%rowtype;
  v_standalone_portion public.portion_types%rowtype;
  v_platter_portion public.portion_types%rowtype;
  v_standalone_weight_kg numeric(10,3);
  v_standalone_portion_weight_kg numeric(10,3);
  v_platter_portion_weight_kg numeric(10,3);
  v_standalone_quantity integer;
  v_platter_quantity integer;
  v_trim_weight_kg numeric(10,3);
  v_standalone_yield_percent numeric(6,2);
  v_platter_yield_percent numeric(6,2);
  v_finished_stock public.finished_stock%rowtype;
  v_batch public.processing_batches%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_service_date date := (now() at time zone 'Africa/Kampala')::date;
begin
  if p_post_roast_packed_weight_kg is null or p_post_roast_packed_weight_kg <= 0 then
    raise exception 'Post-roast packed weight must be greater than zero';
  end if;

  if p_country_platter_weight_kg is null or p_country_platter_weight_kg < 0 then
    raise exception 'Country Platter allocation must be zero or greater';
  end if;

  if p_country_platter_weight_kg > p_post_roast_packed_weight_kg then
    raise exception 'Country Platter allocation cannot exceed the post-roast packed weight';
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
    raise exception 'Only protein receipts can use the Meat Allocator';
  end if;

  select *
  into v_intake_item
  from public.protein_intake_items
  where id = v_receipt.protein_intake_item_id;

  if not found or v_intake_item.code not in ('beef_ribs', 'beef_oxtail', 'goat_ribs', 'goat_chunks') then
    raise exception 'Receipt % is not a Country Platter meat allocation', p_procurement_receipt_id;
  end if;

  if exists (
    select 1
    from public.processing_batches
    where procurement_receipt_id = p_procurement_receipt_id
  ) then
    raise exception 'Protein receipt % already has a completed processing batch', p_procurement_receipt_id;
  end if;

  if p_post_roast_packed_weight_kg > v_receipt.quantity_received then
    raise exception 'Post-roast packed weight cannot exceed raw receipt weight';
  end if;

  if v_receipt.quantity_received is null or v_receipt.quantity_received <= 0 then
    raise exception 'Raw receipt weight must be greater than zero';
  end if;

  select pt.*
  into v_standalone_portion
  from public.protein_intake_item_portions as mapping
  join public.portion_types as pt on pt.id = mapping.portion_type_id
  where mapping.protein_intake_item_id = v_intake_item.id
    and pt.is_active = true
    and pt.code not like 'country_platter_%'
  order by mapping.is_default desc, pt.id
  limit 1;

  select pt.*
  into v_platter_portion
  from public.protein_intake_item_portions as mapping
  join public.portion_types as pt on pt.id = mapping.portion_type_id
  where mapping.protein_intake_item_id = v_intake_item.id
    and pt.is_active = true
    and pt.code like 'country_platter_%'
  order by pt.id
  limit 1;

  if v_standalone_portion.id is null or v_platter_portion.id is null then
    raise exception 'Standalone and Country Platter portions must be configured before processing %', v_intake_item.name;
  end if;

  v_standalone_portion_weight_kg := (regexp_replace(v_standalone_portion.portion_label, '[^0-9.]', '', 'g')::numeric / 1000)::numeric(10,3);
  v_platter_portion_weight_kg := (regexp_replace(v_platter_portion.portion_label, '[^0-9.]', '', 'g')::numeric / 1000)::numeric(10,3);

  if v_standalone_portion_weight_kg <= 0 or v_platter_portion_weight_kg <= 0 then
    raise exception 'Both configured portions must use gram weight labels';
  end if;

  v_standalone_weight_kg := p_post_roast_packed_weight_kg - p_country_platter_weight_kg;
  v_platter_quantity := floor(p_country_platter_weight_kg / v_platter_portion_weight_kg)::integer;
  v_standalone_quantity := floor(v_standalone_weight_kg / v_standalone_portion_weight_kg)::integer;
  v_trim_weight_kg := round(
    p_post_roast_packed_weight_kg
    - (v_platter_quantity * v_platter_portion_weight_kg)
    - (v_standalone_quantity * v_standalone_portion_weight_kg),
    3
  );
  v_standalone_yield_percent := round((v_standalone_weight_kg / v_receipt.quantity_received) * 100, 2);
  v_platter_yield_percent := round((p_country_platter_weight_kg / v_receipt.quantity_received) * 100, 2);

  if v_platter_quantity + v_standalone_quantity <= 0 then
    raise exception 'Packed weight does not make one full sellable meat portion';
  end if;

  if v_standalone_quantity > 0 then
    insert into public.processing_batches (
      procurement_receipt_id,
      portion_type_id,
      quantity_produced,
      post_roast_packed_weight_kg,
      trim_weight_kg,
      yield_percent,
      note
    ) values (
      p_procurement_receipt_id,
      v_standalone_portion.id,
      v_standalone_quantity,
      v_standalone_weight_kg,
      0,
      v_standalone_yield_percent,
      v_note
    ) returning * into v_batch;

    insert into public.finished_stock (portion_type_id, current_quantity)
    values (v_standalone_portion.id, v_standalone_quantity)
    on conflict (portion_type_id) do update
    set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
    returning * into v_finished_stock;

    insert into public.finished_stock_movements (
      portion_type_id, movement_type, quantity_delta, resulting_quantity, processing_batch_id, note
    ) values (
      v_standalone_portion.id, 'production', v_standalone_quantity, v_finished_stock.current_quantity, v_batch.id,
      coalesce(v_note, format('Meat Allocator standalone output from receipt %s', p_procurement_receipt_id))
    );

    insert into public.daily_stock (stock_date, portion_type_id, starting_quantity)
    values (v_service_date, v_standalone_portion.id, v_finished_stock.current_quantity)
    on conflict (stock_date, portion_type_id) do update
    set starting_quantity = public.daily_stock.starting_quantity + v_standalone_quantity;
  end if;

  if v_platter_quantity > 0 then
    insert into public.processing_batches (
      procurement_receipt_id,
      portion_type_id,
      quantity_produced,
      post_roast_packed_weight_kg,
      trim_weight_kg,
      yield_percent,
      note
    ) values (
      p_procurement_receipt_id,
      v_platter_portion.id,
      v_platter_quantity,
      p_country_platter_weight_kg,
      v_trim_weight_kg,
      v_platter_yield_percent,
      v_note
    ) returning * into v_batch;

    insert into public.finished_stock (portion_type_id, current_quantity)
    values (v_platter_portion.id, v_platter_quantity)
    on conflict (portion_type_id) do update
    set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
    returning * into v_finished_stock;

    insert into public.finished_stock_movements (
      portion_type_id, movement_type, quantity_delta, resulting_quantity, processing_batch_id, note
    ) values (
      v_platter_portion.id, 'production', v_platter_quantity, v_finished_stock.current_quantity, v_batch.id,
      coalesce(v_note, format('Meat Allocator Country Platter output from receipt %s', p_procurement_receipt_id))
    );

    insert into public.daily_stock (stock_date, portion_type_id, starting_quantity)
    values (v_service_date, v_platter_portion.id, v_finished_stock.current_quantity)
    on conflict (stock_date, portion_type_id) do update
    set starting_quantity = public.daily_stock.starting_quantity + v_platter_quantity;
  elsif v_standalone_quantity > 0 and v_trim_weight_kg > 0 then
    update public.processing_batches
    set trim_weight_kg = v_trim_weight_kg
    where procurement_receipt_id = p_procurement_receipt_id
      and portion_type_id = v_standalone_portion.id;
  end if;
end;
$$;

-- Existing paid-order consumption keeps its locking, ledger entries and
-- idempotent status changes.  Only the source list now expands a fixed package
-- into its configured stock requirements.
create or replace function public.reserve_paid_order_stock(p_order_id bigint)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_existing_daily_stock public.daily_stock%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_now timestamptz := now();
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.payment_status <> 'paid' then raise exception 'Only paid orders can consume paid stock'; end if;
  if v_order.stock_reserved_at is not null then return v_order; end if;

  if exists (
    select 1 from public.order_items oi join public.menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = p_order_id and mi.portion_type_id is null
  ) then raise exception 'Order % contains a menu item without a sellable portion type', p_order_id; end if;

  for v_item in select * from public.get_order_stock_requirements(p_order_id) loop
    select * into v_finished_stock from public.finished_stock
    where portion_type_id = v_item.portion_type_id for update;
    if not found or v_finished_stock.current_quantity < v_item.quantity_required then
      raise exception 'Insufficient finished stock for portion % on paid order %', v_item.portion_type_id, p_order_id;
    end if;

    select * into v_existing_daily_stock from public.daily_stock
    where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id for update;
    if found then
      if v_existing_daily_stock.remaining_quantity < v_item.quantity_required then
        raise exception 'Insufficient service-day stock for portion % on %', v_item.portion_type_id, v_order.service_date;
      end if;
      update public.daily_stock set reserved_quantity = reserved_quantity + v_item.quantity_required
      where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id;
    else
      insert into public.daily_stock (stock_date, portion_type_id, starting_quantity, reserved_quantity)
      values (v_order.service_date, v_item.portion_type_id, v_finished_stock.current_quantity, v_item.quantity_required);
    end if;

    update public.finished_stock set current_quantity = current_quantity - v_item.quantity_required
    where portion_type_id = v_item.portion_type_id returning * into v_finished_stock;
    insert into public.finished_stock_movements (
      portion_type_id, movement_type, quantity_delta, resulting_quantity, processing_batch_id, note
    ) values (
      v_item.portion_type_id, 'sale', -v_item.quantity_required, v_finished_stock.current_quantity, null,
      format('Paid confirmation stock consumption for order %s (%s).', p_order_id, coalesce(v_order.order_number, 'no order number'))
    );
  end loop;

  update public.orders set
    stock_reserved_at = coalesce(stock_reserved_at, v_now), stock_reservation_status = 'reserved',
    stock_reservation_error = null, stock_reservation_attempted_at = v_now,
    fulfillment_review_required = false, fulfillment_review_reason = null
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.release_reserved_order_stock(p_order_id bigint)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.stock_reserved_at is null or v_order.payment_status = 'paid' then return v_order; end if;

  for v_item in select * from public.get_order_stock_requirements(p_order_id) loop
    update public.daily_stock
    set reserved_quantity = greatest(reserved_quantity - v_item.quantity_required, 0)
    where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id;
  end loop;

  update public.orders set stock_reserved_at = null, stock_reservation_status = 'released'
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.finalize_reserved_order_sale(p_order_id bigint)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.stock_reserved_at is null then
    raise exception 'Order % does not have paid consumed stock to finalize', p_order_id;
  end if;

  for v_item in select * from public.get_order_stock_requirements(p_order_id) loop
    update public.daily_stock
    set reserved_quantity = greatest(reserved_quantity - v_item.quantity_required, 0),
        sold_quantity = sold_quantity + v_item.quantity_required
    where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id;
  end loop;

  update public.orders set stock_reservation_status = 'finalized'
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.get_storefront_menu(p_service_date date)
returns table (
  id bigint,
  name text,
  description text,
  base_price integer,
  image_url text,
  prep_type text,
  portion_label text,
  category_code text,
  category_name text,
  is_active boolean,
  is_available_today boolean,
  available_quantity integer
)
language sql
stable
as $$
  select
    mi.id, mi.name, mi.description, mi.base_price, mi.image_url, mi.prep_type, pt.portion_label,
    mc.code, mc.name, mi.is_active, mi.is_available_today,
    case
      when requirement_stock.requirement_count > 0 then coalesce(requirement_stock.available_quantity, 0)
      when pt.id is null then 0
      when pt.stock_source_portion_type_id is not null then floor(
        coalesce(src_ds.remaining_quantity, src_fs.current_quantity, 0)::numeric
        / greatest(pt.stock_source_units_per_serving, 1)
      )::integer
      else coalesce(ds.remaining_quantity, fs.current_quantity, 0)
    end as available_quantity
  from public.menu_items as mi
  join public.menu_categories as mc on mc.id = mi.menu_category_id
  left join public.portion_types as pt on pt.id = mi.portion_type_id
  left join public.daily_stock as ds on ds.portion_type_id = pt.id and ds.stock_date = p_service_date
  left join public.finished_stock as fs on fs.portion_type_id = pt.id
  left join public.daily_stock as src_ds on src_ds.portion_type_id = pt.stock_source_portion_type_id and src_ds.stock_date = p_service_date
  left join public.finished_stock as src_fs on src_fs.portion_type_id = pt.stock_source_portion_type_id
  left join lateral (
    select
      count(*)::integer as requirement_count,
      min(floor(
        coalesce(requirement_daily_stock.remaining_quantity, requirement_finished_stock.current_quantity, 0)::numeric
        / requirement.units_per_menu_item
      ))::integer as available_quantity
    from public.menu_item_stock_requirements as requirement
    left join public.daily_stock as requirement_daily_stock
      on requirement_daily_stock.portion_type_id = requirement.portion_type_id
      and requirement_daily_stock.stock_date = p_service_date
    left join public.finished_stock as requirement_finished_stock
      on requirement_finished_stock.portion_type_id = requirement.portion_type_id
    where requirement.menu_item_id = mi.id
  ) as requirement_stock on true
  where mi.is_active = true and mi.is_available_today = true
  order by mi.sort_order, mi.name;
$$;

revoke all on function public.get_order_stock_requirements(bigint) from public, anon, authenticated;
grant execute on function public.get_order_stock_requirements(bigint) to service_role;
revoke all on function public.process_standard_weight_meat_receipt_allocation(bigint, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.process_standard_weight_meat_receipt_allocation(bigint, numeric, numeric, text) to service_role;
revoke all on function public.reserve_paid_order_stock(bigint) from public, anon, authenticated;
grant execute on function public.reserve_paid_order_stock(bigint) to service_role;
revoke all on function public.release_reserved_order_stock(bigint) from public, anon, authenticated;
grant execute on function public.release_reserved_order_stock(bigint) to service_role;
revoke all on function public.finalize_reserved_order_sale(bigint) from public, anon, authenticated;
grant execute on function public.finalize_reserved_order_sale(bigint) to service_role;
revoke all on function public.get_storefront_menu(date) from public, anon, authenticated;
grant execute on function public.get_storefront_menu(date) to service_role;

comment on table public.menu_item_stock_requirements is
  'Additional finished-stock pools required by a fixed menu package. Items without rows retain their normal single stock source.';
comment on column public.processing_batches.trim_weight_kg is
  'Cooked meat remainder held as trim; it is never credited as sellable finished stock.';
comment on function public.process_standard_weight_meat_receipt_allocation(bigint, numeric, numeric, text) is
  'Splits a cooked standard-weight meat receipt between standalone and Country Platter portions, recording any non-packable remainder as trim.';

commit;
