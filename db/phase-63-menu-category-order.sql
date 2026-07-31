begin;

-- Keep the shared Admin and Storefront category sequence intentional. This
-- updates existing categories only; it does not create a category if one has
-- not been set up in Menu administration yet.
with classified_categories as (
  select
    id,
    sort_order as current_sort_order,
    case
      when code = 'country_platter' or lower(btrim(name)) = 'country platter' then 1
      when code = 'beef' then 2
      when code = 'goat' then 3
      when code = 'chicken' then 4
      when code = 'sides' then 5
      else null
    end as requested_sort_order
  from public.menu_categories
),
remaining_categories as (
  select
    id,
    5 + row_number() over (order by current_sort_order, id) as requested_sort_order
  from classified_categories
  where requested_sort_order is null
),
ordered_categories as (
  select id, requested_sort_order
  from classified_categories
  where requested_sort_order is not null

  union all

  select id, requested_sort_order
  from remaining_categories
)
update public.menu_categories as category
set sort_order = ordered_categories.requested_sort_order,
    updated_at = now()
from ordered_categories
where category.id = ordered_categories.id
  and category.sort_order is distinct from ordered_categories.requested_sort_order;

commit;
