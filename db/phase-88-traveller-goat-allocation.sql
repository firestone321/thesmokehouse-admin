begin;

-- Goat chunks can be committed to standalone, Country Platter, and 250 g
-- traveller packs from one cooked receipt. The existing allocator handles the
-- first two pools; this wrapper credits the third in the same transaction.
update public.portion_types traveller
set protein_id = standard.protein_id,
    packaging_type_id = standard.packaging_type_id
from public.portion_types standard
where traveller.code = 'traveller_goat_250g' and standard.code = 'goat_chunks_portions';

insert into public.protein_intake_item_portions(protein_intake_item_id, portion_type_id, is_default)
select intake.id, traveller.id, false
from public.protein_intake_items intake
join public.portion_types traveller on traveller.code = 'traveller_goat_250g'
where intake.code = 'goat_chunks'
on conflict (protein_intake_item_id, portion_type_id) do update set is_default = false;

create or replace function public.process_traveller_goat_receipt_allocation(
  p_procurement_receipt_id bigint,
  p_post_roast_packed_weight_kg numeric(10,3),
  p_country_platter_weight_kg numeric(10,3),
  p_traveller_weight_kg numeric(10,3),
  p_note text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_traveller public.portion_types%rowtype;
  v_regular public.portion_types%rowtype;
  v_platter public.portion_types%rowtype;
  v_stock public.finished_stock%rowtype;
  v_batch public.processing_batches%rowtype;
  v_other_weight numeric(10,3);
  v_other_full integer;
  v_traveller_count integer;
  v_trim numeric(10,3);
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  select * into v_receipt from public.procurement_receipts
  where id = p_procurement_receipt_id for update;
  if not found or v_receipt.protein_code <> 'goat_chunks' then
    raise exception 'goat_chunks_receipt_required';
  end if;
  if exists (select 1 from public.processing_batches where procurement_receipt_id = p_procurement_receipt_id) then
    raise exception 'receipt_already_processed';
  end if;
  if p_post_roast_packed_weight_kg is null or p_post_roast_packed_weight_kg <= 0
     or p_post_roast_packed_weight_kg > v_receipt.quantity_received
     or p_country_platter_weight_kg is null or p_country_platter_weight_kg < 0
     or p_traveller_weight_kg is null or p_traveller_weight_kg < 0
     or p_country_platter_weight_kg + p_traveller_weight_kg > p_post_roast_packed_weight_kg then
    raise exception 'invalid_goat_allocation_weights';
  end if;
  select * into v_traveller from public.portion_types
  where code = 'traveller_goat_250g' and portion_label = '250g' and is_active;
  if not found then raise exception 'traveller_goat_portion_not_configured'; end if;

  select * into v_regular from public.portion_types where code = 'goat_chunks_portions';
  select * into v_platter from public.portion_types where code = 'country_platter_goat_chops';
  if v_regular.portion_label <> '400g' or v_platter.portion_label <> '300g' then
    raise exception 'goat_portion_sizes_changed';
  end if;  if p_traveller_weight_kg > 0 and p_traveller_weight_kg < 0.250 then
    raise exception 'traveller_goat_weight_below_one_portion';
  end if;
  v_other_weight := p_post_roast_packed_weight_kg - p_traveller_weight_kg;
  v_other_full := floor(p_country_platter_weight_kg / 0.300)::integer
    + floor((v_other_weight - p_country_platter_weight_kg) / 0.400)::integer;
  v_traveller_count := floor(p_traveller_weight_kg / 0.250)::integer;
  if v_other_full + v_traveller_count = 0 then raise exception 'no_full_goat_portions'; end if;

  if v_other_full > 0 then
    perform public.process_standard_weight_meat_receipt_allocation(
      p_procurement_receipt_id, v_other_weight, p_country_platter_weight_kg, p_note);
  end if;
  if v_traveller_count > 0 then
    v_trim := p_traveller_weight_kg - v_traveller_count * 0.250;
    if v_other_full = 0 then v_trim := v_trim + v_other_weight; end if;
    insert into public.processing_batches
      (procurement_receipt_id, portion_type_id, quantity_produced,
       post_roast_packed_weight_kg, trim_weight_kg, yield_percent, note)
    values (p_procurement_receipt_id, v_traveller.id, v_traveller_count,
      case when v_other_full = 0 then p_post_roast_packed_weight_kg else p_traveller_weight_kg end, v_trim,
      round((case when v_other_full = 0 then p_post_roast_packed_weight_kg else p_traveller_weight_kg end) / v_receipt.quantity_received * 100, 2),
      nullif(btrim(coalesce(p_note, '')), ''))
    returning * into v_batch;
    insert into public.finished_stock(portion_type_id, current_quantity)
    values (v_traveller.id, v_traveller_count)
    on conflict (portion_type_id) do update
    set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
    returning * into v_stock;
    insert into public.finished_stock_movements
      (portion_type_id, movement_type, quantity_delta, resulting_quantity, processing_batch_id, note)
    values (v_traveller.id, 'production', v_traveller_count, v_stock.current_quantity,
      v_batch.id, format('250 g traveller goat allocation from receipt %s', p_procurement_receipt_id));
    insert into public.daily_stock(stock_date, portion_type_id, starting_quantity)
    values (v_today, v_traveller.id, v_stock.current_quantity)
    on conflict (stock_date, portion_type_id) do update
    set starting_quantity = public.daily_stock.starting_quantity + v_traveller_count;
  end if;
end;
$$;

revoke all on function public.process_traveller_goat_receipt_allocation(bigint,numeric,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.process_traveller_goat_receipt_allocation(bigint,numeric,numeric,numeric,text) to service_role;
commit;
