begin;

-- ---------------------------------------------------------------------------
-- Reset fries stock data to a clean blank slate.
-- Keeps: portion_types (fries_250g id=32, large_fries id=39),
--        menu_items (Fries id=8, Fries Large id=15),
--        inventory_items (fries_kg id=3),
--        suppliers, orders, order_items, Phase 35 schema.
-- Removes: all fries stock/movement history so intake can start fresh.
-- ---------------------------------------------------------------------------

-- 1. Finished stock movements for fries portions
delete from public.finished_stock_movements
where portion_type_id in (32, 39);

-- 2. Finished stock (sellable frozen portion counts)
delete from public.finished_stock
where portion_type_id in (32, 39);

-- 3. Daily service stock for fries
delete from public.daily_stock
where portion_type_id in (32, 39);

-- 4. Inventory movements for the raw fries ingredient
delete from public.inventory_movements
where inventory_item_id = 3;

-- 5. Procurement receipts tied to the fries ingredient item
delete from public.procurement_receipts
where inventory_item_id = 3;

-- 6. Zero out raw ingredient running total
update public.inventory_items
set current_quantity = 0
where id = 3;

commit;
