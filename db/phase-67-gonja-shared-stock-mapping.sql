begin;

-- Phase 67: shared Gonja stock.
--
-- Gonja is received in whole clusters. The agreed operating conversion is
-- 10 fingers per cluster at 200g per finger, or 2,000g per cluster. A 25g
-- internal stock unit is the exact common denominator of a 200g finger, the
-- 225g Gonja accompaniment (9 units), and the 600g Gonja Large serving
-- (24 units). It is not a menu item; it is the single physical stock pool.

do $$
declare
  v_gonja_input public.inventory_items%rowtype;
  v_small_gonja public.portion_types%rowtype;
  v_large_gonja public.portion_types%rowtype;
  v_stock_unit public.portion_types%rowtype;
  v_receipt record;
  v_finished_stock public.finished_stock%rowtype;
  v_stock_units integer;
  v_legacy_receipt_quantity numeric(12,2);
begin
  select *
  into v_gonja_input
  from public.inventory_items as ii
  where ii.code = 'gonja'
    and ii.is_active = true
  for update;

  if not found then
    raise exception 'An active Gonja cluster inventory item is required before mapping shared Gonja stock';
  end if;

  if v_gonja_input.unit_name <> 'Cluster' then
    raise exception 'Gonja inventory item must use Cluster units; found %', v_gonja_input.unit_name;
  end if;

  select *
  into v_small_gonja
  from public.portion_types as pt
  where pt.code = 'gonja'
    and pt.is_active = true
  for update;

  if not found or v_small_gonja.portion_label <> '225g' then
    raise exception 'An active 225g Gonja accompaniment portion is required before mapping shared Gonja stock';
  end if;

  select *
  into v_large_gonja
  from public.portion_types as pt
  where pt.code = 'gonja_large'
    and pt.is_active = true
  for update;

  if not found or v_large_gonja.portion_label <> '600g' then
    raise exception 'An active 600g Gonja Large portion is required before mapping shared Gonja stock';
  end if;

  insert into public.portion_types (
    code,
    protein_id,
    packaging_type_id,
    name,
    portion_label,
    sort_order,
    is_active
  )
  values (
    'gonja_stock_25g',
    v_small_gonja.protein_id,
    v_small_gonja.packaging_type_id,
    'Gonja stock unit',
    '25g',
    v_small_gonja.sort_order,
    true
  )
  on conflict (code) do update
  set
    protein_id = excluded.protein_id,
    packaging_type_id = excluded.packaging_type_id,
    name = excluded.name,
    portion_label = excluded.portion_label,
    is_active = true
  returning * into v_stock_unit;

  -- A 225g accompaniment consumes 9 x 25g; a 600g large consumes 24 x 25g.
  update public.portion_types
  set
    stock_source_portion_type_id = v_stock_unit.id,
    stock_source_units_per_serving = case
      when id = v_small_gonja.id then 9
      when id = v_large_gonja.id then 24
    end
  where id in (v_small_gonja.id, v_large_gonja.id);

  -- Receiving one cluster directly credits 80 x 25g stock units.
  update public.inventory_items
  set
    direct_sellable_portion_type_id = v_stock_unit.id,
    sellable_units_per_input = 80,
    requires_whole_input = true,
    source_menu_item_id = null
  where id = v_gonja_input.id
  returning * into v_gonja_input;

  select coalesce(sum(pr.quantity_received), 0)
  into v_legacy_receipt_quantity
  from public.procurement_receipts as pr
  where pr.inventory_item_id = v_gonja_input.id
    and pr.intake_type = 'ingredient';

  -- Backfill only receipts not already represented in the shared finished-stock
  -- pool. The receipt id in the movement note makes this safe to re-run.
  for v_receipt in
    select pr.*
    from public.procurement_receipts as pr
    where pr.inventory_item_id = v_gonja_input.id
      and pr.intake_type = 'ingredient'
      and pr.quantity_received > 0
      and not exists (
        select 1
        from public.finished_stock_movements as fsm
        where fsm.portion_type_id = v_stock_unit.id
          and fsm.note = format('Gonja shared-stock migration backfill for receipt %s.', pr.id)
      )
    order by pr.id
  loop
    v_stock_units := floor(v_receipt.quantity_received * 80)::integer;

    if v_stock_units <= 0 then
      continue;
    end if;

    insert into public.finished_stock (portion_type_id, current_quantity)
    values (v_stock_unit.id, v_stock_units)
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
      v_stock_unit.id,
      'adjustment',
      v_stock_units,
      v_finished_stock.current_quantity,
      null,
      format('Gonja shared-stock migration backfill for receipt %s.', v_receipt.id)
    );

    insert into public.daily_stock (stock_date, portion_type_id, starting_quantity)
    values (v_receipt.delivery_date, v_stock_unit.id, v_stock_units)
    on conflict (stock_date, portion_type_id) do update
    set starting_quantity = public.daily_stock.starting_quantity + excluded.starting_quantity;
  end loop;

  -- Clear the legacy raw-cluster balance only when every recorded cluster is
  -- represented by receipts. This avoids overwriting a separately adjusted
  -- live balance.
  if v_gonja_input.current_quantity = v_legacy_receipt_quantity
    and v_legacy_receipt_quantity > 0
    and not exists (
      select 1
      from public.inventory_movements as im
      where im.inventory_item_id = v_gonja_input.id
        and im.note = 'Gonja shared-stock migration converted the legacy cluster balance to 25g stock units.'
    ) then
    update public.inventory_items
    set current_quantity = 0
    where id = v_gonja_input.id;

    insert into public.inventory_movements (
      inventory_item_id,
      movement_type,
      quantity_delta,
      resulting_quantity,
      note
    )
    values (
      v_gonja_input.id,
      'usage',
      -v_legacy_receipt_quantity,
      0,
      'Gonja shared-stock migration converted the legacy cluster balance to 25g stock units.'
    );
  end if;
end;
$$;

commit;
