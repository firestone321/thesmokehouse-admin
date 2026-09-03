-- Phase 75: configurable recurring menu availability.
-- Days use PostgreSQL/JavaScript weekday numbers: Sunday=0 ... Saturday=6.

alter table public.menu_items
  add column if not exists availability_days smallint[] not null default '{0,1,2,3,4,5,6}',
  add column if not exists availability_start_date date,
  add column if not exists availability_end_date date;

alter table public.menu_items
  drop constraint if exists menu_items_availability_days_chk,
  drop constraint if exists menu_items_availability_date_range_chk;

alter table public.menu_items
  add constraint menu_items_availability_days_chk
    check (cardinality(availability_days) > 0 and availability_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  add constraint menu_items_availability_date_range_chk
    check (availability_end_date is null or availability_start_date is null or availability_end_date >= availability_start_date);

comment on column public.menu_items.availability_days is
  'Recurring service weekdays for this item. Sunday=0 through Saturday=6.';

comment on column public.menu_items.availability_start_date is
  'Optional inclusive date from which the recurring availability schedule applies.';

comment on column public.menu_items.availability_end_date is
  'Optional inclusive date through which the recurring availability schedule applies.';

-- Preserve the existing weekend-special behaviour while making it editable per item.
update public.menu_items
set availability_days = '{0,5,6}'::smallint[]
where lower(regexp_replace(btrim(name), '^smoked\s+', '', 'i')) in ('beef ribs', 'oxtail', 'goat ribs', 'goat chops');

drop function if exists public.get_storefront_menu(date);

create function public.get_storefront_menu(p_service_date date)
returns table (
  id                   bigint,
  name                 text,
  description          text,
  base_price           integer,
  image_url            text,
  prep_type            text,
  portion_label        text,
  category_code        text,
  category_name        text,
  is_active            boolean,
  is_available_today   boolean,
  availability_days    smallint[],
  availability_start_date date,
  availability_end_date date,
  available_quantity   integer
)
language sql
stable
as $$
  select
    mi.id,
    mi.name,
    mi.description,
    mi.base_price,
    mi.image_url,
    mi.prep_type,
    pt.portion_label,
    mc.code,
    mc.name,
    mi.is_active,
    mi.is_available_today,
    mi.availability_days,
    mi.availability_start_date,
    mi.availability_end_date,
    case
      when pt.id is null then 0
      when pt.stock_source_portion_type_id is not null then floor(
        coalesce(src_ds.remaining_quantity, src_fs.current_quantity, 0)::numeric
        / greatest(pt.stock_source_units_per_serving, 1)
      )::integer
      else coalesce(ds.remaining_quantity, fs.current_quantity, 0)
    end as available_quantity
  from public.menu_items mi
  join public.menu_categories mc on mc.id = mi.menu_category_id
  left join public.portion_types pt on pt.id = mi.portion_type_id
  left join public.daily_stock ds on ds.portion_type_id = pt.id and ds.stock_date = p_service_date
  left join public.finished_stock fs on fs.portion_type_id = pt.id
  left join public.daily_stock src_ds on src_ds.portion_type_id = pt.stock_source_portion_type_id and src_ds.stock_date = p_service_date
  left join public.finished_stock src_fs on src_fs.portion_type_id = pt.stock_source_portion_type_id
  where mi.is_active = true
  order by mi.sort_order, mi.name;
$$;

comment on function public.get_storefront_menu(date) is
  'Returns active menu items with computed stock and configurable availability schedule fields.';
