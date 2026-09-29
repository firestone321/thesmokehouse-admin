begin;

-- Cashiers can book one combined bus order or separate passenger orders.
-- Both modes use the same exact traveller SKU prices and stock requirements.
create or replace function public.create_pos_traveller_preorder(
  p_idempotency_key uuid,
  p_request_hash text,
  p_cashier_profile_id uuid,
  p_order_mode text,
  p_customer_name text,
  p_customer_phone text,
  p_bus_reference text,
  p_arrival_at timestamptz,
  p_pay_now boolean,
  p_tender_type text,
  p_amount_received integer,
  p_payment_reference text,
  p_items jsonb
)
returns table (
  id bigint, order_number text, status text, payment_status text,
  total_amount integer, tender_type text, amount_received integer,
  change_given integer, promised_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_order public.orders%rowtype;
  v_existing_request public.pos_sale_requests%rowtype;
  v_inserted boolean;
  v_request_count integer;
  v_valid_count integer;
  v_total bigint;
  v_service_date date := (p_arrival_at at time zone 'Africa/Kampala')::date;
  v_tender text := lower(btrim(coalesce(p_tender_type, '')));
  v_reference text := nullif(btrim(coalesce(p_payment_reference, '')), '');
  v_received integer := coalesce(p_amount_received, 0);
begin
  if p_idempotency_key is null or nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'preorder_idempotency_required';
  end if;
  if p_order_mode not in ('combined','individual') then raise exception 'invalid_preorder_mode'; end if;
  if nullif(btrim(coalesce(p_customer_name, '')), '') is null
     or nullif(btrim(coalesce(p_customer_phone, '')), '') is null then
    raise exception 'preorder_customer_contact_required';
  end if;
  if p_order_mode = 'combined' and nullif(btrim(coalesce(p_bus_reference, '')), '') is null then
    raise exception 'combined_preorder_bus_reference_required';
  end if;
  if p_arrival_at is null or p_arrival_at <= now() or p_arrival_at > now() + interval '30 days' then
    raise exception 'preorder_arrival_must_be_within_30_days';
  end if;
  if p_pay_now is null then raise exception 'preorder_payment_timing_required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 7 then
    raise exception 'invalid_preorder_items';
  end if;
  if length(btrim(p_customer_name)) > 120 or length(btrim(p_customer_phone)) > 30
     or length(coalesce(p_bus_reference,'')) > 120 then
    raise exception 'preorder_contact_too_long';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is null or quantity is null or quantity not between 1 and 200
  ) then raise exception 'invalid_preorder_item_quantity'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    group by menu_item_id having sum(quantity) > 200
  ) then raise exception 'preorder_item_quantity_over_limit'; end if;
  select * into v_actor from public.profiles profile where profile.id = p_cashier_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role, 'manager'::public.app_role, 'cashier'::public.app_role, 'staff'::public.app_role) then
    raise exception 'pos_access_denied';
  end if;

  insert into public.pos_sale_requests(idempotency_key, request_hash, cashier_profile_id)
  values (p_idempotency_key, p_request_hash, p_cashier_profile_id)
  on conflict (idempotency_key) do nothing;
  v_inserted := found;
  if not v_inserted then
    select * into v_existing_request from public.pos_sale_requests
    where idempotency_key = p_idempotency_key for update;
    if v_existing_request.request_hash <> p_request_hash
       or v_existing_request.cashier_profile_id <> p_cashier_profile_id then
      raise exception 'pos_idempotency_key_reused_with_different_request';
    end if;
    if v_existing_request.order_id is null then raise exception 'pos_preorder_still_processing'; end if;
    return query select o.id, o.order_number, o.status, o.payment_status,
      o.total_amount, t.tender_type, t.amount_received, t.change_given, o.promised_at
    from public.orders o left join public.pos_tenders t on t.order_id = o.id
    where o.id = v_existing_request.order_id;
    return;
  end if;

  with requested as (
    select menu_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 200
    group by menu_item_id
  ) select count(*)::integer into v_request_count from requested;
  if v_request_count < 1 then raise exception 'invalid_preorder_item_quantity'; end if;
  perform 1 from public.menu_items mi
  join (
    select distinct menu_item_id
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 200
  ) requested on requested.menu_item_id = mi.id
  for update of mi;
  with requested as (
    select menu_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 200
    group by menu_item_id
  ) select count(*)::integer, coalesce(sum(mi.base_price::bigint * requested.quantity),0)::bigint
  into v_valid_count, v_total
  from requested join public.menu_items mi on mi.id = requested.menu_item_id
  join public.menu_categories mc on mc.id = mi.menu_category_id
  where ((mc.code = 'travellers' and mi.pos_only and mi.code in
      ('traveller_chicken_meal','traveller_goat_meal','traveller_beef_kebabs','traveller_beef_samosas'))
    or (mc.code = 'drinks' and not mi.pos_only and mi.code in
      ('juice','bottled_mineral_water','soda')))
    and mi.is_active and mi.is_available_today
    and extract(dow from v_service_date)::smallint = any(mi.availability_days)
    and (mi.availability_start_date is null or v_service_date >= mi.availability_start_date)
    and (mi.availability_end_date is null or v_service_date <= mi.availability_end_date);
  if v_valid_count <> v_request_count or v_total <= 0 or v_total > 2147483647 then
    raise exception 'preorder_item_unavailable_or_invalid';
  end if;
  if not exists (
    select 1 from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    join public.menu_items mi on mi.id = item.menu_item_id
    where mi.code in ('traveller_chicken_meal','traveller_goat_meal',
      'traveller_beef_kebabs','traveller_beef_samosas') and item.quantity > 0
  ) then raise exception 'traveller_food_required'; end if;
  if p_pay_now then
    if v_tender not in ('cash','mobile_money','card') then raise exception 'invalid_pos_tender'; end if;
    if v_tender = 'cash' then
      if v_received < v_total then raise exception 'insufficient_cash_received'; end if;
    elsif v_received <> v_total or v_reference is null then
      raise exception 'non_cash_tender_requires_exact_amount_and_reference';
    end if;
  elsif v_received <> 0 or v_tender <> '' or v_reference is not null then
    raise exception 'pay_on_arrival_cannot_capture_tender_at_booking';
  end if;

  insert into public.orders
    (customer_name, customer_phone, notes, status, payment_status,
     payment_provider, payment_reference, payment_last_verified_at, paid_at,
     service_date, promised_at, total_amount, order_source, cashier_profile_id)
  values
    (btrim(p_customer_name), btrim(p_customer_phone),
     'Traveller preorder' || case when p_bus_reference is null then '' else ' - bus ' || btrim(p_bus_reference) end,
     'new', case when p_pay_now then 'paid' else 'pending' end,
     case when p_pay_now then 'pos' else null end,
     case when p_pay_now then v_reference else null end,
     case when p_pay_now then now() else null end,
     case when p_pay_now then now() else null end,
     v_service_date, p_arrival_at, v_total::integer, 'pos', p_cashier_profile_id)
  returning * into v_order;
  insert into public.pos_traveller_preorders
    (order_id, order_mode, payment_timing, bus_reference, created_by_profile_id)
  values (v_order.id, p_order_mode, case when p_pay_now then 'booking' else 'arrival' end,
    nullif(btrim(coalesce(p_bus_reference,'')),''), p_cashier_profile_id);
  with requested as (
    select menu_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 200
    group by menu_item_id
  ) insert into public.order_items(order_id, menu_item_id, menu_item_name, quantity, unit_price)
  select v_order.id, mi.id, mi.name, requested.quantity, mi.base_price
  from requested join public.menu_items mi on mi.id = requested.menu_item_id;
  perform public.reserve_paid_order_stock(v_order.id);
  if p_pay_now then
    insert into public.pos_tenders
      (order_id, tender_type, amount, amount_received, payment_reference, captured_by_profile_id)
    values (v_order.id, v_tender, v_total::integer, v_received, v_reference, p_cashier_profile_id);
  end if;
  insert into public.order_status_events(order_id, event_type, from_status, to_status, note)
  values (v_order.id, 'created', null, 'new',
    case when p_pay_now then 'Traveller preorder paid at booking; held for arrival.'
         else 'Traveller preorder stock held; payment due on arrival.' end);
  insert into public.staff_activity_log
    (actor_profile_id, actor_email_snapshot, actor_role_snapshot, action,
     entity_type, entity_id, order_id, summary, metadata)
  values (v_actor.id, v_actor.email, v_actor.role, 'pos.traveller_preorder_created',
    'order', v_order.id::text, v_order.id,
    v_actor.email || ' created traveller preorder ' || v_order.order_number || '.',
    jsonb_build_object('order_mode',p_order_mode,'payment_timing',case when p_pay_now then 'booking' else 'arrival' end,
      'arrival_at',p_arrival_at,'total_amount',v_total));
  update public.pos_sale_requests set order_id = v_order.id, completed_at = now()
  where idempotency_key = p_idempotency_key;
  return query select o.id, o.order_number, o.status, o.payment_status,
    o.total_amount, t.tender_type, t.amount_received, t.change_given, o.promised_at
  from public.orders o left join public.pos_tenders t on t.order_id = o.id
  where o.id = v_order.id;
end;
$$;

revoke all on function public.create_pos_traveller_preorder(uuid,text,uuid,text,text,text,text,timestamptz,boolean,text,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_pos_traveller_preorder(uuid,text,uuid,text,text,text,text,timestamptz,boolean,text,integer,text,jsonb) to service_role;
commit;
