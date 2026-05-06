begin;

-- Phase 39: Collapsed storefront menu read model.
-- Replaces the three-query storefront path (menu_items join, daily_stock, finished_stock)
-- with one stable RPC that the /api/menu route and the homepage SSR path both call.
-- Handles Phase 35 source-backed portions and Phase 38 finished_stock fallback for
-- uninitialized service days.

create or replace function public.get_storefront_menu(p_service_date date)
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
    mc.code  as category_code,
    mc.name  as category_name,
    mi.is_active,
    mi.is_available_today,
    case
      when pt.id is null
        then 0
      when pt.stock_source_portion_type_id is not null
        then floor(
          coalesce(src_ds.remaining_quantity, src_fs.current_quantity, 0)::numeric
          / greatest(pt.stock_source_units_per_serving, 1)
        )::integer
      else
        coalesce(ds.remaining_quantity, fs.current_quantity, 0)
    end as available_quantity
  from public.menu_items mi
  join public.menu_categories mc
    on mc.id = mi.menu_category_id
  left join public.portion_types pt
    on pt.id = mi.portion_type_id
  left join public.daily_stock ds
    on ds.portion_type_id = pt.id
   and ds.stock_date = p_service_date
  left join public.finished_stock fs
    on fs.portion_type_id = pt.id
  left join public.daily_stock src_ds
    on src_ds.portion_type_id = pt.stock_source_portion_type_id
   and src_ds.stock_date = p_service_date
  left join public.finished_stock src_fs
    on src_fs.portion_type_id = pt.stock_source_portion_type_id
  where mi.is_active = true
    and mi.is_available_today = true
  order by mi.sort_order, mi.name;
$$;

revoke execute on function public.get_storefront_menu(date) from public, anon, authenticated;
grant execute on function public.get_storefront_menu(date) to service_role;

comment on function public.get_storefront_menu(date) is
  'Returns active, available-today menu items with computed available_quantity in one DB round trip. Handles Phase 35 source-backed portions and Phase 38 finished_stock fallback for uninitialized service days.';

commit;
