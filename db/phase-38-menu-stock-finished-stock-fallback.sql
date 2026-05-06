begin;

-- Phase 38: Menu stock fallback for source-backed portions.
-- daily_stock is the same-day operational ledger; finished_stock is the
-- durable stock truth. If a new service day has no daily_stock row yet,
-- menu/admin stock must still derive availability from finished_stock.

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
      then floor(coalesce(src_ds.starting_quantity, src_fs.current_quantity, 0)::numeric / pt.stock_source_units_per_serving)::integer
      else coalesce(ds.starting_quantity, fs.current_quantity, 0)
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
      then floor(coalesce(src_ds.remaining_quantity, src_fs.current_quantity, 0)::numeric / pt.stock_source_units_per_serving)::integer
      else coalesce(ds.remaining_quantity, fs.current_quantity, 0)
    end as remaining_quantity,
    case
      when pt.stock_source_portion_type_id is not null then (src_ds.portion_type_id is not null)
      else (ds.portion_type_id is not null)
    end as is_initialized
  from public.portion_types pt
  left join public.proteins pr
    on pr.id = pt.protein_id
  left join public.packaging_types pkg
    on pkg.id = pt.packaging_type_id
  left join public.daily_stock ds
    on ds.portion_type_id = pt.id
   and ds.stock_date = p_stock_date
  left join public.daily_stock src_ds
    on src_ds.portion_type_id = pt.stock_source_portion_type_id
   and src_ds.stock_date = p_stock_date
  left join public.finished_stock fs
    on fs.portion_type_id = pt.id
  left join public.finished_stock src_fs
    on src_fs.portion_type_id = pt.stock_source_portion_type_id
  left join order_item_totals ot
    on ot.portion_type_id = pt.id
  where pt.is_active = true
  order by pt.sort_order, pt.id;
$$;

comment on function public.get_daily_menu_stock(date) is
  'Returns active menu portions for a service day; falls back to durable finished_stock when day stock has not been initialized.';

commit;
