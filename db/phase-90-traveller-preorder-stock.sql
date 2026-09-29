begin;

create table if not exists public.pos_traveller_preorders (
  order_id bigint primary key references public.orders(id) on delete restrict,
  order_mode text not null check (order_mode in ('combined', 'individual')),
  payment_timing text not null check (payment_timing in ('booking', 'arrival')),
  bus_reference text,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  check (bus_reference is null or btrim(bus_reference) <> '')
);
alter table public.pos_traveller_preorders enable row level security;
revoke all on public.pos_traveller_preorders from public, anon, authenticated;
grant all on public.pos_traveller_preorders to service_role;

-- Pending pay-on-arrival preorders hold physical stock at booking. Paid sales
-- retain the existing reservation path and lock order.
create or replace function public.reserve_paid_order_stock(p_order_id bigint)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_existing_daily_stock public.daily_stock%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_now timestamptz := now();
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.payment_status <> 'paid' and not (
    v_order.order_source = 'pos' and v_order.payment_status = 'pending' and exists (
      select 1 from public.pos_traveller_preorders preorder
      where preorder.order_id = p_order_id and preorder.payment_timing = 'arrival'
    )
  ) then raise exception 'Only paid orders or held traveller preorders can reserve stock'; end if;
  if v_order.stock_reserved_at is not null then return v_order; end if;

  if exists (
    select 1 from public.order_items oi join public.menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = p_order_id and mi.portion_type_id is null
  ) then raise exception 'Order % contains a menu item without a sellable portion type', p_order_id; end if;

  for v_item in select * from public.get_order_stock_requirements(p_order_id) loop
    select * into v_finished_stock from public.finished_stock
    where portion_type_id = v_item.portion_type_id for update;
    if not found or v_finished_stock.current_quantity < v_item.quantity_required then
      raise exception 'Insufficient finished stock for portion % on paid order %', v_item.portion_type_id, p_order_id;
    end if;

    select * into v_existing_daily_stock from public.daily_stock
    where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id for update;
    if found then
      -- Future-day rows are snapshots; restocks after the first booking must be
      -- reflected before checking availability. Finished stock is locked and
      -- already excludes every outstanding hold, across all service dates.
      if v_order.service_date > (v_now at time zone 'Africa/Kampala')::date then
        update public.daily_stock
        set starting_quantity = v_finished_stock.current_quantity
          + reserved_quantity + sold_quantity + waste_quantity
        where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id
        returning * into v_existing_daily_stock;
      end if;
      if v_existing_daily_stock.remaining_quantity < v_item.quantity_required then
        raise exception 'Insufficient service-day stock for portion % on %', v_item.portion_type_id, v_order.service_date;
      end if;
      update public.daily_stock set reserved_quantity = reserved_quantity + v_item.quantity_required
      where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id;
    else
      insert into public.daily_stock (stock_date, portion_type_id, starting_quantity, reserved_quantity)
      values (v_order.service_date, v_item.portion_type_id, v_finished_stock.current_quantity, v_item.quantity_required);
    end if;

    update public.finished_stock set current_quantity = current_quantity - v_item.quantity_required
    where portion_type_id = v_item.portion_type_id returning * into v_finished_stock;
    insert into public.finished_stock_movements (
      portion_type_id, movement_type, quantity_delta, resulting_quantity, processing_batch_id, note
    ) values (
      v_item.portion_type_id, 'sale', -v_item.quantity_required, v_finished_stock.current_quantity, null,
      format('Order stock reservation for order %s (%s).', p_order_id, coalesce(v_order.order_number, 'no order number'))
    );
  end loop;

  update public.orders set
    stock_reserved_at = coalesce(stock_reserved_at, v_now), stock_reservation_status = 'reserved',
    stock_reservation_error = null, stock_reservation_attempted_at = v_now,
    fulfillment_review_required = false, fulfillment_review_reason = null
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.release_reserved_order_stock(p_order_id bigint)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_finished_stock public.finished_stock%rowtype;
  v_is_traveller_hold boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_order.stock_reserved_at is null or v_order.payment_status = 'paid' then return v_order; end if;

  select exists (select 1 from public.pos_traveller_preorders where order_id = p_order_id and payment_timing = 'arrival')
  into v_is_traveller_hold;

  for v_item in select * from public.get_order_stock_requirements(p_order_id) loop
    if v_is_traveller_hold then
      update public.daily_stock
      set reserved_quantity = reserved_quantity - v_item.quantity_required
      where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id
        and reserved_quantity >= v_item.quantity_required;
      if not found then raise exception 'traveller_hold_daily_stock_mismatch'; end if;
      update public.finished_stock
      set current_quantity = current_quantity + v_item.quantity_required
      where portion_type_id = v_item.portion_type_id
      returning * into v_finished_stock;
      if not found then raise exception 'traveller_hold_finished_stock_missing'; end if;
      insert into public.finished_stock_movements
        (portion_type_id, movement_type, quantity_delta, resulting_quantity, note)
      values (v_item.portion_type_id, 'adjustment', v_item.quantity_required,
        v_finished_stock.current_quantity, format('Released unpaid traveller preorder %s', p_order_id));
    else
      update public.daily_stock
      set reserved_quantity = greatest(reserved_quantity - v_item.quantity_required, 0)
      where stock_date = v_order.service_date and portion_type_id = v_item.portion_type_id;
    end if;
  end loop;

  update public.orders set stock_reserved_at = null, stock_reservation_status = 'released'
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;
revoke all on function public.reserve_paid_order_stock(bigint) from public, anon, authenticated;
grant execute on function public.reserve_paid_order_stock(bigint) to service_role;
revoke all on function public.release_reserved_order_stock(bigint) from public, anon, authenticated;
grant execute on function public.release_reserved_order_stock(bigint) to service_role;
commit;