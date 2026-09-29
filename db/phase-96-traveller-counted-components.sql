begin;

-- Prepared salad and filled sauce cups, plus universal 330ml soda bottles/cans, are
-- counted as finished servings. A recorded batch reference prevents duplicate
-- posting. This does not reclassify existing raw supply balances.
create table if not exists public.traveller_component_restocks (
  id bigint generated always as identity primary key,
  portion_type_id bigint not null references public.portion_types(id) on delete restrict,
  source_reference text not null check (length(btrim(source_reference)) between 1 and 120),
  quantity_counted integer not null check (quantity_counted between 1 and 10000),
  source_units_consumed numeric(12,2),
  note text,
  recorded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (portion_type_id, source_reference)
);
alter table public.traveller_component_restocks enable row level security;
revoke all on public.traveller_component_restocks from public, anon, authenticated;
grant all on public.traveller_component_restocks to service_role;
grant usage, select on sequence public.traveller_component_restocks_id_seq to service_role;

create or replace function public.record_traveller_component_restock(
  p_portion_code text,
  p_source_reference text,
  p_quantity_counted integer,
  p_actor_profile_id uuid,
  p_source_units_consumed numeric(12,2) default null,
  p_note text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_portion public.portion_types%rowtype;
  v_actor public.profiles%rowtype;
  v_restock_id bigint;
  v_stock public.finished_stock%rowtype;
  v_soda_input public.inventory_items%rowtype;
  v_sauce_input public.inventory_items%rowtype;
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  select * into v_actor from public.profiles where id = p_actor_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'chef'::public.app_role,'staff'::public.app_role) then
    raise exception 'procurement_access_denied';
  end if;
  if p_portion_code not in ('traveller_salad','traveller_sauce','soda_bottle_330ml')
     or p_quantity_counted is null or p_quantity_counted not between 1 and 10000
     or length(btrim(coalesce(p_source_reference,''))) not between 1 and 120 then
    raise exception 'invalid_traveller_component_restock';
  end if;
  select * into v_portion from public.portion_types
  where code = p_portion_code and is_active for update;
  if not found or v_portion.stock_source_portion_type_id is not null then
    raise exception 'traveller_component_portion_not_configured';
  end if;
  if p_portion_code = 'soda_bottle_330ml' then
    if p_source_units_consumed is null or p_source_units_consumed <= 0
       or trunc(p_source_units_consumed) <> p_source_units_consumed then
      raise exception 'soda_cartons_consumed_required';
    end if;
    select * into v_soda_input from public.inventory_items
    where code='soda' and lower(unit_name)='carton' for update;
    if not found or v_soda_input.current_quantity < p_source_units_consumed then
      raise exception 'insufficient_raw_soda_cartons';
    end if;
  elsif p_portion_code = 'traveller_sauce' then
    if p_source_units_consumed is null or p_source_units_consumed < 0
       or p_source_units_consumed > p_quantity_counted
       or trunc(p_source_units_consumed) <> p_source_units_consumed then
      raise exception 'sauce_cups_used_count_required';
    end if;
    if p_source_units_consumed > 0 then
      select * into v_sauce_input from public.inventory_items
      where code='sauce_cups' and lower(unit_name) in ('pcs','pieces') for update;
      if not found or v_sauce_input.current_quantity < p_source_units_consumed then
        raise exception 'insufficient_raw_sauce_cups';
      end if;
    end if;
  elsif p_source_units_consumed is not null then
    raise exception 'source_units_not_applicable_to_salad';
  end if;
  insert into public.traveller_component_restocks
    (portion_type_id,source_reference,quantity_counted,source_units_consumed,note,recorded_by_profile_id)
  values (v_portion.id,btrim(p_source_reference),p_quantity_counted,p_source_units_consumed,
    nullif(btrim(coalesce(p_note,'')),''),p_actor_profile_id)
  returning id into v_restock_id;
  if p_portion_code = 'traveller_sauce' and p_source_units_consumed > 0 then
    update public.inventory_items
    set current_quantity=current_quantity-p_source_units_consumed
    where id=v_sauce_input.id returning * into v_sauce_input;
    insert into public.inventory_movements
      (inventory_item_id,movement_type,quantity_delta,resulting_quantity,note)
    values (v_sauce_input.id,'usage',-p_source_units_consumed,v_sauce_input.current_quantity,
      format('Counted traveller sauce restock %s: %s filled servings',v_restock_id,p_quantity_counted));
  end if;
  if p_portion_code = 'soda_bottle_330ml' then
    update public.inventory_items
    set current_quantity=current_quantity-p_source_units_consumed
    where id=v_soda_input.id returning * into v_soda_input;
    insert into public.inventory_movements
      (inventory_item_id,movement_type,quantity_delta,resulting_quantity,note)
    values (v_soda_input.id,'usage',-p_source_units_consumed,v_soda_input.current_quantity,
      format('Counted traveller soda restock %s: %s bottles/cans',v_restock_id,p_quantity_counted));
  end if;
  insert into public.finished_stock(portion_type_id,current_quantity)
  values (v_portion.id,p_quantity_counted)
  on conflict (portion_type_id) do update
  set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
  returning * into v_stock;
  insert into public.finished_stock_movements
    (portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
  values (v_portion.id,'production',p_quantity_counted,v_stock.current_quantity,
    format('Counted traveller restock %s, source %s',v_restock_id,btrim(p_source_reference)));
  insert into public.daily_stock(stock_date,portion_type_id,starting_quantity)
  values (v_today,v_portion.id,v_stock.current_quantity)
  on conflict (stock_date,portion_type_id) do update
  set starting_quantity = public.daily_stock.starting_quantity + p_quantity_counted;
  return v_restock_id;
end;
$$;
revoke all on function public.record_traveller_component_restock(text,text,integer,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.record_traveller_component_restock(text,text,integer,uuid,numeric,text) to service_role;

commit;