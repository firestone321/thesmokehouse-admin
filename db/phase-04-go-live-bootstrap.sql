begin;

-- Phase 4: go-live operational bootstrap.
-- Purpose:
-- 1. Create the first real menu_items rows from the already-approved portion types.
-- 2. Avoid polluting production with fake orders or guessed stock movement history.
-- 3. Keep every inserted menu item disabled until pricing and live availability are confirmed.

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
  pt.code,
  mc.id,
  pt.id,
  case pt.code
    when 'beef_ribs_350g' then 'Beef ribs'
    when 'beef_chunks_350g' then 'Beef chunks'
    when 'chicken_half' then 'Chicken half'
    when 'chicken_quarter' then 'Chicken quarter'
    when 'goat_chops' then 'Goat chops'
    when 'juice' then 'Juice'
  end as name,
  case pt.code
    when 'beef_ribs_350g' then 'Smoked beef ribs portion.'
    when 'beef_chunks_350g' then 'Packed beef chunks portion.'
    when 'chicken_half' then 'Half chicken smoked and boxed.'
    when 'chicken_quarter' then 'Quarter chicken smoked and boxed.'
    when 'goat_chops' then 'Goat chops portion.'
    when 'juice' then 'Fresh juice serving.'
  end as description,
  0 as base_price,
  case pt.code
    when 'beef_chunks_350g' then 'packed'
    when 'juice' then 'drink'
    else 'smoked'
  end as prep_type,
  false as is_active,
  false as is_available_today,
  case pt.code
    when 'beef_ribs_350g' then 1
    when 'beef_chunks_350g' then 2
    when 'chicken_half' then 3
    when 'chicken_quarter' then 4
    when 'goat_chops' then 5
    when 'juice' then 6
  end as sort_order
from public.portion_types pt
join public.menu_categories mc
  on mc.code = case
    when pt.code in ('beef_ribs_350g', 'beef_chunks_350g') then 'beef'
    when pt.code in ('chicken_half', 'chicken_quarter') then 'chicken'
    when pt.code = 'goat_chops' then 'goat'
    when pt.code = 'juice' then 'drinks'
  end
where pt.code in (
  'beef_ribs_350g',
  'beef_chunks_350g',
  'chicken_half',
  'chicken_quarter',
  'goat_chops',
  'juice'
)
on conflict (portion_type_id) do update
set
  code = excluded.code,
  menu_category_id = excluded.menu_category_id,
  name = excluded.name,
  description = excluded.description,
  prep_type = excluded.prep_type,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Intentionally not inserting inventory_items here.
-- Inventory counts, reorder thresholds, and component usage should be real numbers
-- entered from actual kitchen operations, not guessed during bootstrap.

-- Required live follow-up after this script:
-- 1. Set the correct base_price for each menu item.
-- 2. Activate only the items the smokehouse is actually selling.
-- 3. Mark only today's available items as available_today.
-- 4. Add inventory_items and menu_item_components using real kitchen quantities.

commit;
