begin;

-- ---------------------------------------------------------------------------
-- Phase 35: Shared fries inventory
-- ---------------------------------------------------------------------------
-- fries_250g (accompaniment, 250g) and large_fries (side, 450g) are the same
-- frozen fries ingredient. fries_250g is the canonical inventory unit.
-- large_fries sources from fries_250g and deducts 2 units per serving
-- (450g / 250g rounded up).
-- ---------------------------------------------------------------------------

-- 1. Add stock source columns to portion_types

alter table public.portion_types
  add column if not exists stock_source_portion_type_id bigint
    references public.portion_types(id),
  add column if not exists stock_source_units_per_serving integer not null default 1
    check (stock_source_units_per_serving >= 1);

create index if not exists portion_types_stock_source_idx
  on public.portion_types (stock_source_portion_type_id)
  where stock_source_portion_type_id is not null;

-- 2. Wire large_fries to source from fries_250g with a 2-unit deduction per serving

update public.portion_types
set
  stock_source_portion_type_id = (select id from public.portion_types where code = 'fries_250g'),
  stock_source_units_per_serving = 2
where code = 'large_fries';

-- 3. Replace get_daily_menu_stock with source-aware version
-- Sourced portions derive their stock from the source row. Their reserved and
-- sold counters still need to show the portion-specific order counts so the
-- inventory view can report Fries Large separately while sharing physical stock.

create or replace function public.get_daily_menu_stock(p_stock_date date)
returns table (
  stock_date date,
  portion_type_id bigint,
  portion_code text,
  portion_name text,
  portion_label text,
  protein_name text,
  packaging_type_name text,
  starting_quantity integer,
  reserved_quantity integer,
  sold_quantity integer,
  waste_quantity integer,
  remaining_quantity integer,
  is_initialized boolean
)
language sql
stable
as $$
  with order_item_totals as (
    select
      mi.portion_type_id,
      sum(
        case
          when o.payment_status = 'paid'
           and o.status <> 'completed'
           and o.status <> 'cancelled'
           and o.stock_reserved_at is not null
          then oi.quantity
          else 0
        end
      )::integer as reserved_quantity,
      sum(
        case
          when o.payment_status = 'paid'
           and o.status = 'completed'
          then oi.quantity
          else 0
        end
      )::integer as sold_quantity
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.menu_items mi on mi.id = oi.menu_item_id
    where o.service_date = p_stock_date
      and o.payment_status = 'paid'
      and o.status <> 'cancelled'
      and mi.portion_type_id is not null
    group by mi.portion_type_id
  )
  select
    p_stock_date as stock_date,
    pt.id as portion_type_id,
    pt.code as portion_code,
    pt.name as portion_name,
    pt.portion_label,
    pr.name as protein_name,
    pkg.name as packaging_type_name,
    case
      when pt.stock_source_portion_type_id is not null
      then floor(coalesce(src_ds.starting_quantity, 0)::numeric / pt.stock_source_units_per_serving)::integer
      else coalesce(ds.starting_quantity, 0)
    end as starting_quantity,
    case
      when pt.stock_source_portion_type_id is not null then coalesce(ot.reserved_quantity, 0)
      else coalesce(ds.reserved_quantity, 0)
    end as reserved_quantity,
    case
      when pt.stock_source_portion_type_id is not null then coalesce(ot.sold_quantity, 0)
      else coalesce(ds.sold_quantity, 0)
    end as sold_quantity,
    case
      when pt.stock_source_portion_type_id is not null then 0
      else coalesce(ds.waste_quantity, 0)
    end as waste_quantity,
    case
      when pt.stock_source_portion_type_id is not null
      then floor(coalesce(src_ds.remaining_quantity, 0)::numeric / pt.stock_source_units_per_serving)::integer
      else coalesce(ds.remaining_quantity, 0)
    end as remaining_quantity,
    case
      when pt.stock_source_portion_type_id is not null then (src_ds.portion_type_id is not null)
      else (ds.portion_type_id is not null)
    end as is_initialized
  from public.portion_types pt
  left join public.proteins pr on pr.id = pt.protein_id
  left join public.packaging_types pkg on pkg.id = pt.packaging_type_id
  left join public.daily_stock ds
    on ds.portion_type_id = pt.id
   and ds.stock_date = p_stock_date
  left join public.daily_stock src_ds
    on src_ds.portion_type_id = pt.stock_source_portion_type_id
   and src_ds.stock_date = p_stock_date
  left join order_item_totals ot
    on ot.portion_type_id = pt.id
  where pt.is_active = true
  order by pt.sort_order, pt.id;
$$;

-- 4. Replace reserve_paid_order_stock with source-aware version
-- Order items are aggregated by effective_portion_type_id so that an order
-- containing both fries_250g and large_fries correctly combines into a single
-- deduction from fries_250g stock.

create or replace function public.reserve_paid_order_stock(
  p_order_id bigint
)
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
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'Only paid orders can consume paid stock';
  end if;

  if v_order.stock_reserved_at is not null then
    return v_order;
  end if;

  if exists (
    select 1
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = p_order_id
      and mi.portion_type_id is null
  ) then
    raise exception 'Order % contains a menu item without a sellable portion type', p_order_id;
  end if;

  for v_item in
    select
      coalesce(pt.stock_source_portion_type_id, mi.portion_type_id) as effective_portion_type_id,
      sum(oi.quantity * coalesce(pt.stock_source_units_per_serving, 1))::integer as quantity_required
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id
    join public.portion_types pt on pt.id = mi.portion_type_id
    where oi.order_id = p_order_id
    group by coalesce(pt.stock_source_portion_type_id, mi.portion_type_id)
    order by coalesce(pt.stock_source_portion_type_id, mi.portion_type_id)
  loop
    select *
    into v_finished_stock
    from public.finished_stock
    where portion_type_id = v_item.effective_portion_type_id
    for update;

    if not found or v_finished_stock.current_quantity < v_item.quantity_required then
      raise exception 'Insufficient finished stock for portion % on paid order %', v_item.effective_portion_type_id, p_order_id;
    end if;

    select *
    into v_existing_daily_stock
    from public.daily_stock
    where stock_date = v_order.service_date
      and portion_type_id = v_item.effective_portion_type_id
    for update;

    if found then
      if v_existing_daily_stock.remaining_quantity < v_item.quantity_required then
        raise exception 'Insufficient service-day stock for portion % on %', v_item.effective_portion_type_id, v_order.service_date;
      end if;

      update public.daily_stock
      set reserved_quantity = reserved_quantity + v_item.quantity_required
      where stock_date = v_order.service_date
        and portion_type_id = v_item.effective_portion_type_id;
    else
      insert into public.daily_stock (
        stock_date,
        portion_type_id,
        starting_quantity,
        reserved_quantity
      )
      values (
        v_order.service_date,
        v_item.effective_portion_type_id,
        v_finished_stock.current_quantity,
        v_item.quantity_required
      );
    end if;

    update public.finished_stock
    set current_quantity = current_quantity - v_item.quantity_required
    where portion_type_id = v_item.effective_portion_type_id
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
      v_item.effective_portion_type_id,
      'sale',
      -v_item.quantity_required,
      v_finished_stock.current_quantity,
      null,
      format(
        'Paid confirmation stock consumption for order %s (%s).',
        p_order_id,
        coalesce(v_order.order_number, 'no order number')
      )
    );
  end loop;

  update public.orders
  set
    stock_reserved_at = coalesce(stock_reserved_at, v_now),
    stock_reservation_status = 'reserved',
    stock_reservation_error = null,
    stock_reservation_attempted_at = v_now,
    fulfillment_review_required = false,
    fulfillment_review_reason = null
  where id = p_order_id
  returning *
  into v_order;

  return v_order;
end;
$$;

-- 5. Replace release_reserved_order_stock with source-aware version

create or replace function public.release_reserved_order_stock(
  p_order_id bigint
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.stock_reserved_at is null then
    return v_order;
  end if;

  if v_order.payment_status = 'paid' then
    return v_order;
  end if;

  for v_item in
    select
      coalesce(pt.stock_source_portion_type_id, mi.portion_type_id) as effective_portion_type_id,
      sum(oi.quantity * coalesce(pt.stock_source_units_per_serving, 1))::integer as quantity_required
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id
    join public.portion_types pt on pt.id = mi.portion_type_id
    where oi.order_id = p_order_id
      and mi.portion_type_id is not null
    group by coalesce(pt.stock_source_portion_type_id, mi.portion_type_id)
    order by coalesce(pt.stock_source_portion_type_id, mi.portion_type_id)
  loop
    update public.daily_stock
    set reserved_quantity = greatest(reserved_quantity - v_item.quantity_required, 0)
    where stock_date = v_order.service_date
      and portion_type_id = v_item.effective_portion_type_id;
  end loop;

  update public.orders
  set
    stock_reserved_at = null,
    stock_reservation_status = 'released'
  where id = p_order_id
  returning *
  into v_order;

  return v_order;
end;
$$;

-- 6. Replace finalize_reserved_order_sale with source-aware version

create or replace function public.finalize_reserved_order_sale(
  p_order_id bigint
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.stock_reserved_at is null then
    raise exception 'Order % does not have paid consumed stock to finalize', p_order_id;
  end if;

  for v_item in
    select
      coalesce(pt.stock_source_portion_type_id, mi.portion_type_id) as effective_portion_type_id,
      sum(oi.quantity * coalesce(pt.stock_source_units_per_serving, 1))::integer as quantity_required
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id
    join public.portion_types pt on pt.id = mi.portion_type_id
    where oi.order_id = p_order_id
      and mi.portion_type_id is not null
    group by coalesce(pt.stock_source_portion_type_id, mi.portion_type_id)
    order by coalesce(pt.stock_source_portion_type_id, mi.portion_type_id)
  loop
    update public.daily_stock
    set
      reserved_quantity = greatest(reserved_quantity - v_item.quantity_required, 0),
      sold_quantity = sold_quantity + v_item.quantity_required
    where stock_date = v_order.service_date
      and portion_type_id = v_item.effective_portion_type_id;
  end loop;

  update public.orders
  set stock_reservation_status = 'finalized'
  where id = p_order_id
  returning *
  into v_order;

  return v_order;
end;
$$;

commit;
