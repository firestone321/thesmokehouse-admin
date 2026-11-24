-- Additive: existing processing functions and historical stock remain unchanged.
-- Apply before deploying the corresponding Resupplies UI; verify the live menu mapping first.
begin;

create or replace function public.process_goat_chops_four_way_allocation(
  p_procurement_receipt_id bigint,
  p_post_roast_packed_weight_kg numeric,
  p_country_platter_weight_kg numeric,
  p_traveller_weight_kg numeric,
  p_standalone_400_weight_kg numeric,
  p_note text default null
) returns void language plpgsql set search_path = public as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_400 public.portion_types%rowtype;
  v_250 public.portion_types%rowtype;
  v_platter public.portion_types%rowtype;
  v_traveller public.portion_types%rowtype;
  v_menu_id bigint;
  v_250_weight numeric;
  v_ids bigint[];
  v_weights numeric[];
  v_sizes numeric[] := array[0.400, 0.250, 0.300, 0.250];
  v_quantities integer[];
  v_trim numeric;
  v_unpacked numeric := 0;
  v_output record;
  v_first boolean := true;
  v_packed numeric;
  v_batch public.processing_batches%rowtype;
  v_stock public.finished_stock%rowtype;
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  if p_post_roast_packed_weight_kg is null or p_post_roast_packed_weight_kg <= 0
    or p_country_platter_weight_kg is null or p_country_platter_weight_kg < 0
    or p_traveller_weight_kg is null or p_traveller_weight_kg < 0
    or p_standalone_400_weight_kg is null or p_standalone_400_weight_kg < 0
    or round(p_post_roast_packed_weight_kg, 3) <> p_post_roast_packed_weight_kg
    or round(p_country_platter_weight_kg, 3) <> p_country_platter_weight_kg
    or round(p_traveller_weight_kg, 3) <> p_traveller_weight_kg
    or round(p_standalone_400_weight_kg, 3) <> p_standalone_400_weight_kg
    or p_country_platter_weight_kg + p_traveller_weight_kg + p_standalone_400_weight_kg > p_post_roast_packed_weight_kg then
    raise exception 'invalid_goat_allocation_weights';
  end if;

  select * into v_receipt from public.procurement_receipts where id = p_procurement_receipt_id for update;
  if not found or v_receipt.intake_type is distinct from 'protein' or v_receipt.protein_code is distinct from 'goat_chunks' then
    raise exception 'goat_chunks_receipt_required';
  end if;
  if v_receipt.quantity_received is null or v_receipt.quantity_received <= 0
    or p_post_roast_packed_weight_kg > v_receipt.quantity_received then
    raise exception 'invalid_roasted_goat_weight';
  end if;
  if exists (select 1 from public.processing_batches where procurement_receipt_id = p_procurement_receipt_id) then
    raise exception 'receipt_already_processed';
  end if;

  select * into v_400 from public.portion_types where code = 'goat_chunks_portions' and portion_label = '400g' and is_active;
  select * into v_platter from public.portion_types where code = 'country_platter_goat_chops' and portion_label = '300g' and is_active;
  select * into v_traveller from public.portion_types where code = 'traveller_goat_250g' and portion_label = '250g' and is_active;
  select mi.id into v_menu_id from public.menu_items mi join public.portion_types pt on pt.id = mi.portion_type_id
    where mi.code = 'goat_chops_250g' and pt.portion_label = '250g' and pt.is_active;
  select pt.* into v_250 from public.menu_items mi join public.portion_types pt on pt.id = mi.portion_type_id where mi.id = v_menu_id;
  if v_400.id is null or v_250.id is null or v_platter.id is null or v_traveller.id is null
    or coalesce(v_250.stock_source_portion_type_id, v_250.id) <> v_250.id
    or coalesce(v_250.stock_source_units_per_serving, 1) <> 1
    or exists (select 1 from public.menu_item_stock_requirements where menu_item_id = v_menu_id and (portion_type_id <> v_250.id or units_per_menu_item <> 1)) then
    raise exception 'goat_portion_mapping_invalid';
  end if;
  v_ids := array[v_400.id, v_250.id, v_platter.id, v_traveller.id];
  if (select count(distinct id) from unnest(v_ids) as ids(id)) <> 4 then raise exception 'goat_portions_must_be_distinct'; end if;

  v_250_weight := p_post_roast_packed_weight_kg - p_standalone_400_weight_kg - p_country_platter_weight_kg - p_traveller_weight_kg;
  v_weights := array[p_standalone_400_weight_kg, v_250_weight, p_country_platter_weight_kg, p_traveller_weight_kg];
  v_quantities := array[floor(v_weights[1]/v_sizes[1])::integer, floor(v_weights[2]/v_sizes[2])::integer,
    floor(v_weights[3]/v_sizes[3])::integer, floor(v_weights[4]/v_sizes[4])::integer];
  if v_quantities[1] + v_quantities[2] + v_quantities[3] + v_quantities[4] = 0 then raise exception 'no_full_goat_portions'; end if;
  v_trim := p_post_roast_packed_weight_kg - (v_quantities[1]*v_sizes[1] + v_quantities[2]*v_sizes[2] + v_quantities[3]*v_sizes[3] + v_quantities[4]*v_sizes[4]);
  for i in 1..4 loop if v_quantities[i] = 0 then v_unpacked := v_unpacked + v_weights[i]; end if; end loop;

  -- Stable lock order avoids conflicting multi-portion batches taking stock rows in opposite order.
  for v_output in select v_ids[i] as portion_id, v_weights[i] as weight, v_quantities[i] as quantity
    from generate_subscripts(v_ids, 1) i where v_quantities[i] > 0 order by v_ids[i]
  loop
    v_packed := v_output.weight + case when v_first then v_unpacked else 0 end;
    insert into public.processing_batches (procurement_receipt_id, portion_type_id, quantity_produced, post_roast_packed_weight_kg, trim_weight_kg, yield_percent, note)
    values (p_procurement_receipt_id, v_output.portion_id, v_output.quantity, v_packed,
      case when v_first then v_trim else 0 end, round(v_packed / v_receipt.quantity_received * 100, 2), nullif(btrim(coalesce(p_note, '')), '')) returning * into v_batch;
    insert into public.finished_stock(portion_type_id,current_quantity) values(v_output.portion_id,v_output.quantity)
      on conflict(portion_type_id) do update set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity returning * into v_stock;
    insert into public.finished_stock_movements(portion_type_id,movement_type,quantity_delta,resulting_quantity,processing_batch_id,note)
      values(v_output.portion_id,'production',v_output.quantity,v_stock.current_quantity,v_batch.id,coalesce(nullif(btrim(coalesce(p_note,'')),''),format('Goat allocation from receipt %s',p_procurement_receipt_id)));
    insert into public.daily_stock(stock_date,portion_type_id,starting_quantity) values(v_today,v_output.portion_id,v_stock.current_quantity)
      on conflict(stock_date,portion_type_id) do update set starting_quantity = public.daily_stock.starting_quantity + v_output.quantity;
    v_first := false;
  end loop;
end;
$$;
revoke all on function public.process_goat_chops_four_way_allocation(bigint,numeric,numeric,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.process_goat_chops_four_way_allocation(bigint,numeric,numeric,numeric,numeric,text) to service_role;
commit;
