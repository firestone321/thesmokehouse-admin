begin;

-- Phase 7: inventory opening balances.
-- Purpose:
-- 1. Enter the real opening quantity for tracked inventory items.
-- 2. Set the real reorder threshold for each tracked item.
-- 3. Record the quantity change through apply_inventory_adjustment so movement history is preserved.
--
-- How to use:
-- 1. Replace the empty balance_inputs CTE with real rows.
-- 2. target_quantity is the quantity you want the system to show after this script.
-- 3. reorder_threshold is the level that should trigger low-stock attention.

with balance_inputs as (
  select
    null::text as code,
    null::numeric(12,2) as target_quantity,
    null::numeric(12,2) as reorder_threshold,
    null::text as note
  where false

  -- Example shape only. Replace with real values:
  -- union all select 'clamcraft_box_unit', 120, 30, 'Opening balance'
  -- union all select 'butcher_paper_sheet', 80, 20, 'Opening balance'
),
threshold_updates as (
  update public.inventory_items ii
  set
    reorder_threshold = bi.reorder_threshold,
    updated_at = now()
  from balance_inputs bi
  where ii.code = bi.code
  returning
    ii.id,
    ii.code,
    ii.current_quantity,
    bi.target_quantity,
    bi.note
)
select public.apply_inventory_adjustment(
  tu.id,
  tu.target_quantity - tu.current_quantity,
  case
    when tu.target_quantity - tu.current_quantity >= 0 then 'restock'
    else 'usage'
  end,
  coalesce(nullif(btrim(tu.note), ''), 'Opening balance')
)
from threshold_updates tu
where tu.target_quantity <> tu.current_quantity;

commit;
