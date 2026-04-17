begin;

-- Phase 6: menu prices and activation.
-- Purpose:
-- 1. Set real selling prices for the menu items created in Phase 4.
-- 2. Decide which items should be active in the system.
-- 3. Decide which active items are actually available today.
--
-- How to use:
-- 1. Replace the empty menu_updates CTE with real rows.
-- 2. Keep one row per menu_items.code.
-- 3. Run this file only after reviewing the values.

with menu_updates as (
  select
    null::text as code,
    null::integer as base_price,
    null::boolean as is_active,
    null::boolean as is_available_today
  where false

  -- Example shape only. Replace with real values:
  -- union all select 'beef_ribs_300g', 35000, true, true
  -- union all select 'beef_chunks_300g', 30000, true, true
  -- union all select 'goat_ribs_300g', 35000, true, true
  -- union all select 'goat_chunks_300g', 30000, true, true
  -- union all select 'fries_250g', 12000, true, true
  -- union all select 'gonja_250g', 12000, true, true
  -- union all select 'juice', 5000, true, true
)
update public.menu_items mi
set
  base_price = mu.base_price,
  is_active = mu.is_active,
  is_available_today = mu.is_available_today,
  updated_at = now()
from menu_updates mu
where mi.code = mu.code;

commit;
