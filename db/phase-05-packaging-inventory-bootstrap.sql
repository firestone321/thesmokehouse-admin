begin;

-- Phase 5: packaging inventory bootstrap.
-- Purpose:
-- 1. Create the first tracked inventory items that are explicitly known from the menu model.
-- 2. Link packaging usage to menu items without inventing meat yield or recipe consumption.
-- 3. Leave actual opening balances and reorder thresholds for real operational entry after bootstrap.

insert into public.inventory_items (
  code,
  name,
  unit_name,
  current_quantity,
  reorder_threshold,
  is_active
)
values
  (
    'clamcraft_box_unit',
    'Clamcraft box',
    'piece',
    0,
    0,
    true
  ),
  (
    'butcher_paper_sheet',
    'Butcher paper sheet',
    'sheet',
    0,
    0,
    true
  )
on conflict (code) do update
set
  name = excluded.name,
  unit_name = excluded.unit_name,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.menu_item_components (
  menu_item_id,
  inventory_item_id,
  quantity_required
)
select
  mi.id,
  ii.id,
  1
from public.menu_items mi
join public.inventory_items ii
  on ii.code = case
    when mi.code = 'beef_chunks_300g' then 'butcher_paper_sheet'
    when mi.code in (
      'beef_ribs_300g',
      'chicken_half',
      'chicken_quarter',
      'goat_ribs_300g',
      'goat_chunks_300g'
    ) then 'clamcraft_box_unit'
  end
where mi.code in (
  'beef_ribs_300g',
  'beef_chunks_300g',
  'chicken_half',
  'chicken_quarter',
  'goat_ribs_300g',
  'goat_chunks_300g'
)
on conflict (menu_item_id, inventory_item_id) do update
set
  quantity_required = excluded.quantity_required;

-- Intentionally deferred:
-- 1. Meat recipe consumption per menu item
-- 2. Charcoal, firewood, spices, juice ingredients, and staff-use consumables
-- 3. Opening balances and reorder thresholds
-- 4. Historical inventory movements

-- Required live follow-up after this script:
-- 1. Enter real current_quantity values for packaging items.
-- 2. Enter real reorder_threshold values.
-- 3. Add additional inventory_items only when the kitchen is ready to track them operationally.
-- 4. Add menu_item_components for non-packaging ingredients only when the quantities are real.

commit;
