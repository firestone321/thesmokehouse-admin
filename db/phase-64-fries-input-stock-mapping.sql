begin;

-- Phase 64: reconcile the live Fries input with its sellable portions.
-- The production rows predate the normalized fries_kg/fries_250g identifiers:
-- they are named fries and fries_large_portion instead. Keep those live names
-- and connect them to the direct-sellable intake path.

do $$
declare
  v_small_fries public.portion_types%rowtype;
  v_fries_input public.inventory_items%rowtype;
  v_receipt record;
  v_finished_stock public.finished_stock%rowtype;
  v_sellable_quantity integer;
  v_legacy_receipt_quantity numeric(12,2);
begin
  select *
  into v_small_fries
  from public.portion_types as pt
  where pt.code in ('fries', 'fries_250g')
    and pt.is_active = true
  order by case pt.code when 'fries' then 0 else 1 end
  limit 1;

  if not found then
    raise exception 'An active small Fries portion is required before mapping Fries input';
  end if;

  select *
  into v_fries_input
  from public.inventory_items as ii
  where ii.direct_sellable_portion_type_id = v_small_fries.id
     or ii.code in ('fries', 'fries_kg')
  order by case when ii.direct_sellable_portion_type_id = v_small_fries.id then 0 else 1 end,
           case ii.code when 'fries' then 0 else 1 end
  limit 1
  for update;

  if not found then
    raise exception 'A Fries input inventory item is required before mapping sellable Fries stock';
  end if;

  update public.inventory_items
  set
    direct_sellable_portion_type_id = v_small_fries.id,
    sellable_units_per_input = 4,
    requires_whole_input = false,
    source_menu_item_id = coalesce(
      source_menu_item_id,
      (
        select mi.id
        from public.menu_items as mi
        where mi.portion_type_id = v_small_fries.id
        order by mi.id
        limit 1
      )
    )
  where id = v_fries_input.id
  returning * into v_fries_input;

  -- One Large Fries serving consumes two small Fries stock units, so both menu
  -- items reserve and sell from the same physical Fries pool. Phase 55 keeps
  -- their reserved/sold display counts separate by menu portion.
  update public.portion_types
  set
    stock_source_portion_type_id = v_small_fries.id,
    stock_source_units_per_serving = 2
  where code in ('fries_large_portion', 'large_fries')
    and id <> v_small_fries.id;

  select coalesce(sum(pr.quantity_received), 0)
  into v_legacy_receipt_quantity
  from public.procurement_receipts as pr
  where pr.inventory_item_id = v_fries_input.id
    and pr.intake_type = 'ingredient';

  -- Move every legacy Fries receipt that has not already been converted into
  -- sellable stock. The receipt id in the movement note makes this idempotent.
  for v_receipt in
    select pr.*
    from public.procurement_receipts as pr
    where pr.inventory_item_id = v_fries_input.id
      and pr.intake_type = 'ingredient'
      and pr.quantity_received > 0
      and not exists (
        select 1
        from public.finished_stock_movements as fsm
        where fsm.portion_type_id = v_small_fries.id
          and fsm.note = format('Fries direct-stock migration backfill for receipt %s.', pr.id)
      )
    order by pr.id
  loop
    v_sellable_quantity := floor(v_receipt.quantity_received * v_fries_input.sellable_units_per_input)::integer;

    if v_sellable_quantity <= 0 then
      continue;
    end if;

    insert into public.finished_stock (portion_type_id, current_quantity)
    values (v_small_fries.id, v_sellable_quantity)
    on conflict (portion_type_id) do update
    set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
    returning * into v_finished_stock;

    insert into public.finished_stock_movements (
      portion_type_id,
      movement_type,
      quantity_delta,
      resulting_quantity,
      processing_batch_id,
      note
    )
    values (
      v_small_fries.id,
      'adjustment',
      v_sellable_quantity,
      v_finished_stock.current_quantity,
      null,
      format('Fries direct-stock migration backfill for receipt %s.', v_receipt.id)
    );

    insert into public.daily_stock (stock_date, portion_type_id, starting_quantity)
    values (v_receipt.delivery_date, v_small_fries.id, v_sellable_quantity)
    on conflict (stock_date, portion_type_id) do update
    set starting_quantity = public.daily_stock.starting_quantity + excluded.starting_quantity;
  end loop;

  -- The legacy row was a raw-count ledger. Clear it only when its full balance
  -- is explained by its ingredient receipts, avoiding a blind overwrite of a
  -- separately adjusted stock balance.
  if v_fries_input.current_quantity = v_legacy_receipt_quantity
    and v_legacy_receipt_quantity > 0
    and not exists (
      select 1
      from public.inventory_movements as im
      where im.inventory_item_id = v_fries_input.id
        and im.note = 'Fries direct-stock migration converted the legacy raw balance to sellable Fries portions.'
    ) then
    update public.inventory_items
    set current_quantity = 0
    where id = v_fries_input.id;

    insert into public.inventory_movements (
      inventory_item_id,
      movement_type,
      quantity_delta,
      resulting_quantity,
      note
    )
    values (
      v_fries_input.id,
      'usage',
      -v_legacy_receipt_quantity,
      0,
      'Fries direct-stock migration converted the legacy raw balance to sellable Fries portions.'
    );
  end if;
end;
$$;

commit;
