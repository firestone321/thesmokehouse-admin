begin;

-- Operational reset: wipe live stock and inventory activity back to zero.
-- Purpose:
-- 1. Remove live stock, movement, procurement, and processing history.
-- 2. Reset tracked inventory quantities back to zero without deleting item definitions.
-- 3. Preserve suppliers, menu structure, pricing, and other reference/master data.
--
-- Intentionally preserved:
-- - public.suppliers
-- - public.inventory_items rows themselves
-- - reorder thresholds and item metadata on public.inventory_items
-- - menu tables, portion types, proteins, packaging, and orders

-- Clear finished-stock history first because it points at processing batches.
delete from public.finished_stock_movements;

-- Clear processing history before deleting procurement receipts.
delete from public.processing_batches;

-- Remove current finished frozen stock snapshots.
delete from public.finished_stock;

-- Remove procurement history for both protein and supply intake.
delete from public.procurement_receipts;

-- Remove tracked supply movement history.
delete from public.inventory_movements;

-- Remove daily sellable stock rows so service-day stock starts clean.
delete from public.daily_stock;

-- Keep inventory item definitions but zero out their live quantities.
update public.inventory_items
set
  current_quantity = 0,
  updated_at = now();

-- Restart identity counters for wiped operational tables.
alter table public.finished_stock_movements alter column id restart with 1;
alter table public.processing_batches alter column id restart with 1;
alter table public.procurement_receipts alter column id restart with 1;
alter table public.inventory_movements alter column id restart with 1;

commit;
