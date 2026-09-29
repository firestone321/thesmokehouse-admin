begin;

-- Phase 98: traveller salad and sauce accompany a sale but never gate it.
-- No traveller order may have been reserved under the earlier hard-requirement rule.
do $$
begin
  if exists (select 1 from public.pos_traveller_preorders) then
    raise exception 'traveller_orders_exist_review_reservations_before_phase_98';
  end if;
end;
$$;

create table public.traveller_order_accompaniments (
  order_id bigint not null references public.orders(id) on delete restrict,
  portion_type_id bigint not null references public.portion_types(id) on delete restrict,
  quantity_expected integer not null check (quantity_expected > 0),
  quantity_reserved integer not null check (quantity_reserved >= 0 and quantity_reserved <= quantity_expected),
  recorded_at timestamptz not null default now(),
  primary key (order_id, portion_type_id)
);
alter table public.traveller_order_accompaniments enable row level security;
revoke all on public.traveller_order_accompaniments from public, anon, authenticated;
grant all on public.traveller_order_accompaniments to service_role;

-- Keep main food, including the universal chicken quarter and fries, in the
-- hard requirements. The two prepared accompaniments are counted separately.
delete from public.menu_item_stock_requirements requirement
using public.menu_items item, public.portion_types portion
where requirement.menu_item_id = item.id
  and requirement.portion_type_id = portion.id
  and item.code in ('traveller_chicken_meal','traveller_goat_meal',
    'traveller_beef_kebabs','traveller_beef_samosas')
  and portion.code in ('traveller_salad','traveller_sauce');

do $$
begin
  if (select count(*) from public.menu_item_stock_requirements requirement
      join public.menu_items item on item.id=requirement.menu_item_id
      where item.code in ('traveller_chicken_meal','traveller_goat_meal',
        'traveller_beef_kebabs','traveller_beef_samosas')) <> 6 then
    raise exception 'traveller_main_food_requirements_unexpected';
  end if;
end;
$$;

-- Once an accompaniment is counted at check-in, use its durable order row
-- for completion and reconciliation. Before check-in only main food is held.
create or replace function public.get_order_stock_requirements(p_order_id bigint)
returns table (portion_type_id bigint, quantity_required integer)
language sql stable set search_path = public
as $$
  with components as (
    select coalesce(requirement.portion_type_id, source_portion.id) as portion_type_id,
      order_item.quantity * coalesce(requirement.units_per_menu_item,
        menu_portion.stock_source_units_per_serving,1) as quantity_required
    from public.order_items order_item
    join public.menu_items menu_item on menu_item.id=order_item.menu_item_id
    join public.portion_types menu_portion on menu_portion.id=menu_item.portion_type_id
    left join public.menu_item_stock_requirements requirement
      on requirement.menu_item_id=menu_item.id
    left join public.portion_types source_portion on source_portion.id=coalesce(
      menu_portion.stock_source_portion_type_id,menu_item.portion_type_id)
    where order_item.order_id=p_order_id
    union all
    select accompaniment.portion_type_id, accompaniment.quantity_reserved
    from public.traveller_order_accompaniments accompaniment
    where accompaniment.order_id=p_order_id and accompaniment.quantity_reserved>0
  )
  select components.portion_type_id, sum(components.quantity_required)::integer
  from components
  group by components.portion_type_id
  order by components.portion_type_id;
$$;
revoke all on function public.get_order_stock_requirements(bigint) from public,anon,authenticated;
grant execute on function public.get_order_stock_requirements(bigint) to service_role;

create or replace function public.record_traveller_accompaniments(p_order_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_component record;
  v_finished public.finished_stock%rowtype;
  v_daily public.daily_stock%rowtype;
  v_has_daily boolean;
  v_count integer;
  v_today date := (now() at time zone 'Africa/Kampala')::date;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.payment_status <> 'paid'
     or v_order.stock_reservation_status <> 'reserved'
     or v_order.stock_reserved_at is null then
    raise exception 'traveller_accompaniment_order_not_ready';
  end if;

  for v_component in
    select portion.id as portion_type_id,
      sum(order_item.quantity * recipe.units)::integer as quantity_expected
    from public.order_items order_item
    join public.menu_items item on item.id=order_item.menu_item_id
    join (values
      ('traveller_chicken_meal','traveller_salad',1),
      ('traveller_chicken_meal','traveller_sauce',1),
      ('traveller_goat_meal','traveller_salad',1),
      ('traveller_goat_meal','traveller_sauce',1),
      ('traveller_beef_kebabs','traveller_sauce',1),
      ('traveller_beef_samosas','traveller_sauce',1)
    ) recipe(menu_code,portion_code,units) on recipe.menu_code=item.code
    join public.portion_types portion on portion.code=recipe.portion_code
    where order_item.order_id=p_order_id
    group by portion.id
    order by portion.id
  loop
    if exists (select 1 from public.traveller_order_accompaniments
      where order_id=p_order_id and portion_type_id=v_component.portion_type_id) then
      continue;
    end if;
    select * into v_finished from public.finished_stock
    where portion_type_id=v_component.portion_type_id for update;
    select * into v_daily from public.daily_stock
    where stock_date=v_order.service_date and portion_type_id=v_component.portion_type_id for update;
    v_has_daily := found;
    if v_has_daily and v_order.service_date>v_today then
      update public.daily_stock
      set starting_quantity=coalesce(v_finished.current_quantity,0)
        +reserved_quantity+sold_quantity+waste_quantity
      where stock_date=v_order.service_date and portion_type_id=v_component.portion_type_id
      returning * into v_daily;
    end if;
    v_count := least(v_component.quantity_expected,
      greatest(coalesce(v_finished.current_quantity,0),0),
      greatest(case when v_has_daily then v_daily.remaining_quantity
        else coalesce(v_finished.current_quantity,0) end,0));
    insert into public.traveller_order_accompaniments
      (order_id,portion_type_id,quantity_expected,quantity_reserved)
    values (p_order_id,v_component.portion_type_id,v_component.quantity_expected,v_count);
    if v_count>0 then
      if v_has_daily then
        update public.daily_stock set reserved_quantity=reserved_quantity+v_count
        where stock_date=v_order.service_date and portion_type_id=v_component.portion_type_id;
      else
        insert into public.daily_stock
          (stock_date,portion_type_id,starting_quantity,reserved_quantity)
        values (v_order.service_date,v_component.portion_type_id,
          v_finished.current_quantity,v_count);
      end if;
      update public.finished_stock
      set current_quantity=current_quantity-v_count
      where portion_type_id=v_component.portion_type_id
      returning * into v_finished;
      insert into public.finished_stock_movements
        (portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
      values (v_component.portion_type_id,'sale',-v_count,v_finished.current_quantity,
        format('Traveller accompaniment counted at check-in for order %s',p_order_id));
    end if;
  end loop;
end;
$$;
revoke all on function public.record_traveller_accompaniments(bigint) from public,anon,authenticated;
grant execute on function public.record_traveller_accompaniments(bigint) to service_role;

create or replace function public.record_traveller_accompaniments_on_check_in()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.record_traveller_accompaniments(new.order_id);
  return new;
end;
$$;
revoke all on function public.record_traveller_accompaniments_on_check_in() from public,anon,authenticated;

drop trigger if exists traveller_accompaniments_on_check_in on public.pos_traveller_preorders;
create trigger traveller_accompaniments_on_check_in
  after update of checked_in_at on public.pos_traveller_preorders
  for each row
  when (old.checked_in_at is null and new.checked_in_at is not null)
  execute function public.record_traveller_accompaniments_on_check_in();

commit;
