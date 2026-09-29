begin;

-- Staff selects the physical cooked batch. Current sales consume a pooled
-- finished-stock balance, so batch identity is an attestation rather than a
-- claim that historical sales have been assigned to particular batches.
create table if not exists public.traveller_beef_conversions (
  id bigint generated always as identity primary key,
  source_processing_batch_id bigint not null references public.processing_batches(id) on delete restrict,
  source_portion_type_id bigint not null references public.portion_types(id) on delete restrict,
  source_portions_used integer not null check (source_portions_used between 1 and 10000),
  skewers_produced integer not null check (skewers_produced between 0 and 10000),
  samosas_produced integer not null check (samosas_produced between 0 and 10000),
  cooked_on date not null,
  early_conversion_acknowledged boolean not null default false,
  batch_reference text not null check (length(btrim(batch_reference)) between 1 and 120),
  note text,
  recorded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (source_processing_batch_id,batch_reference),
  check (skewers_produced + samosas_produced > 0)
);
alter table public.traveller_beef_conversions enable row level security;
revoke all on public.traveller_beef_conversions from public,anon,authenticated;
grant all on public.traveller_beef_conversions to service_role;
grant usage, select on sequence public.traveller_beef_conversions_id_seq to service_role;

create or replace view public.traveller_beef_conversion_totals as
select source_processing_batch_id, sum(source_portions_used)::integer as portions_converted
from public.traveller_beef_conversions
group by source_processing_batch_id;
revoke all on public.traveller_beef_conversion_totals from public,anon,authenticated;
grant select on public.traveller_beef_conversion_totals to service_role;
create or replace function public.convert_cooked_beef_to_traveller_pieces(
  p_source_processing_batch_id bigint,
  p_source_portions_used integer,
  p_skewers_produced integer,
  p_samosas_produced integer,
  p_cooked_on date,
  p_early_conversion_acknowledged boolean,
  p_batch_reference text,
  p_actor_profile_id uuid,
  p_note text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_batch public.processing_batches%rowtype;
  v_portion public.portion_types%rowtype;
  v_source_stock public.finished_stock%rowtype;
  v_output_stock public.finished_stock%rowtype;
  v_output_id bigint;
  v_output_code text;
  v_output_count integer;
  v_conversion_id bigint;
  v_prior_count integer;
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  select * into v_actor from public.profiles where id=p_actor_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'chef'::public.app_role,'staff'::public.app_role) then
    raise exception 'procurement_access_denied';
  end if;
  if p_source_portions_used is null or p_source_portions_used not between 1 and 10000
     or p_skewers_produced is null or p_skewers_produced not between 0 and 10000
     or p_samosas_produced is null or p_samosas_produced not between 0 and 10000
     or p_skewers_produced+p_samosas_produced < 1
     or p_cooked_on is null or p_cooked_on > v_today
     or length(btrim(coalesce(p_batch_reference,''))) not between 1 and 120 then
    raise exception 'invalid_traveller_beef_conversion';
  end if;
  select * into v_batch from public.processing_batches
  where id=p_source_processing_batch_id for update;
  if not found then raise exception 'source_processing_batch_not_found'; end if;
  select * into v_portion from public.portion_types where id=v_batch.portion_type_id;
  if not found or not exists (
    select 1 from public.proteins protein
    where protein.id=v_portion.protein_id and protein.code='beef'
  ) or v_portion.stock_source_portion_type_id is not null then
    raise exception 'beef_finished_portion_required';
  end if;
  if p_cooked_on > (v_batch.created_at at time zone 'Africa/Kampala')::date then
    raise exception 'cook_date_after_processing_batch';
  end if;
  if p_cooked_on > v_today-2 and not coalesce(p_early_conversion_acknowledged,false) then
    raise exception 'conversion_under_two_days_requires_acknowledgement';
  end if;
  select coalesce(sum(source_portions_used),0)::integer into v_prior_count
  from public.traveller_beef_conversions where source_processing_batch_id=v_batch.id;
  if v_prior_count+p_source_portions_used > v_batch.quantity_produced then
    raise exception 'source_batch_conversion_count_exceeded';
  end if;
  select * into v_source_stock from public.finished_stock
  where portion_type_id=v_portion.id for update;
  if not found or v_source_stock.current_quantity < p_source_portions_used then
    raise exception 'insufficient_beef_finished_stock';
  end if;
  insert into public.traveller_beef_conversions
    (source_processing_batch_id,source_portion_type_id,source_portions_used,
     skewers_produced,samosas_produced,cooked_on,early_conversion_acknowledged,
     batch_reference,note,recorded_by_profile_id)
  values (v_batch.id,v_portion.id,p_source_portions_used,p_skewers_produced,
    p_samosas_produced,p_cooked_on,coalesce(p_early_conversion_acknowledged,false),
    btrim(p_batch_reference),nullif(btrim(coalesce(p_note,'')),''),p_actor_profile_id)
  returning id into v_conversion_id;
  update public.finished_stock set current_quantity=current_quantity-p_source_portions_used
  where portion_type_id=v_portion.id returning * into v_source_stock;
  insert into public.finished_stock_movements
    (portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
  values (v_portion.id,'adjustment',-p_source_portions_used,v_source_stock.current_quantity,
    format('Converted to traveller beef pieces, conversion %s',v_conversion_id));
  update public.daily_stock
  set starting_quantity=starting_quantity-p_source_portions_used
  where stock_date=v_today and portion_type_id=v_portion.id
    and remaining_quantity >= p_source_portions_used;
  if not found and exists (select 1 from public.daily_stock where stock_date=v_today and portion_type_id=v_portion.id) then
    raise exception 'insufficient_service_day_beef_stock';
  end if;
  for v_output_code,v_output_count in
    select * from (values
      ('traveller_beef_skewer',p_skewers_produced),
      ('traveller_beef_samosa_piece',p_samosas_produced)
    ) as output(code,quantity)
  loop
    if v_output_count > 0 then
      select id into v_output_id from public.portion_types
      where code=v_output_code and is_active and stock_source_portion_type_id is null;
      if v_output_id is null then raise exception 'traveller_beef_output_not_configured'; end if;
      insert into public.finished_stock(portion_type_id,current_quantity)
      values (v_output_id,v_output_count)
      on conflict (portion_type_id) do update
      set current_quantity=public.finished_stock.current_quantity+excluded.current_quantity
      returning * into v_output_stock;
      insert into public.finished_stock_movements
        (portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
      values (v_output_id,'production',v_output_count,v_output_stock.current_quantity,
        format('Traveller beef conversion %s from batch %s',v_conversion_id,v_batch.id));
      insert into public.daily_stock(stock_date,portion_type_id,starting_quantity)
      values (v_today,v_output_id,v_output_stock.current_quantity)
      on conflict (stock_date,portion_type_id) do update
      set starting_quantity=public.daily_stock.starting_quantity+v_output_count;
    end if;
  end loop;
  return v_conversion_id;
end;
$$;
revoke all on function public.convert_cooked_beef_to_traveller_pieces(bigint,integer,integer,integer,date,boolean,text,uuid,text) from public,anon,authenticated;
grant execute on function public.convert_cooked_beef_to_traveller_pieces(bigint,integer,integer,integer,date,boolean,text,uuid,text) to service_role;

commit;