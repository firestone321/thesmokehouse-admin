-- Phase 69: Repair the POS sale RPC's ambiguous output-column reference.
-- Apply after Phase 68 in every environment where the POS foundation is live.

begin;

create or replace function public.create_pos_sale(
  p_idempotency_key uuid,
  p_request_hash text,
  p_cashier_profile_id uuid,
  p_tender_type text,
  p_amount_received integer,
  p_payment_reference text,
  p_items jsonb
)
returns table (
  id bigint,
  order_number text,
  status text,
  total_amount integer,
  tender_type text,
  amount_received integer,
  change_given integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_order public.orders%rowtype;
  v_existing_request public.pos_sale_requests%rowtype;
  v_request_inserted boolean := false;
  v_requested_item_count integer;
  v_valid_item_count integer;
  v_total bigint;
  v_normalized_tender text := lower(trim(coalesce(p_tender_type, '')));
  v_reference text := nullif(btrim(coalesce(p_payment_reference, '')), '');
  v_amount_received integer := coalesce(p_amount_received, 0);
  v_change integer;
begin
  if p_idempotency_key is null then
    raise exception 'pos_idempotency_key_required';
  end if;
  if nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'pos_request_hash_required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid_pos_items';
  end if;
  if v_normalized_tender not in ('cash', 'mobile_money', 'card') then
    raise exception 'invalid_pos_tender';
  end if;

  select * into v_actor from public.profiles as profile where profile.id = p_cashier_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role, 'manager'::public.app_role, 'cashier'::public.app_role) then
    raise exception 'pos_access_denied';
  end if;

  insert into public.pos_sale_requests (idempotency_key, request_hash, cashier_profile_id)
  values (p_idempotency_key, p_request_hash, p_cashier_profile_id)
  on conflict (idempotency_key) do nothing;
  v_request_inserted := found;

  if not v_request_inserted then
    select * into v_existing_request
    from public.pos_sale_requests
    where idempotency_key = p_idempotency_key
    for update;

    if v_existing_request.request_hash <> p_request_hash or v_existing_request.cashier_profile_id <> p_cashier_profile_id then
      raise exception 'pos_idempotency_key_reused_with_different_request';
    end if;
    if v_existing_request.order_id is null then
      raise exception 'pos_sale_still_processing';
    end if;

    return query
    select o.id, o.order_number, o.status, o.total_amount, t.tender_type, t.amount_received, t.change_given
    from public.orders o
    join public.pos_tenders t on t.order_id = o.id
    where o.id = v_existing_request.order_id;
    return;
  end if;

  with requested as (
    select menu_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 20
    group by menu_item_id
  )
  select count(*)::integer into v_requested_item_count from requested;

  if coalesce(v_requested_item_count, 0) < 1 then
    raise exception 'invalid_pos_item_quantity';
  end if;

  perform 1
  from public.menu_items mi
  join (
    select menu_item_id
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 20
    group by menu_item_id
  ) requested on requested.menu_item_id = mi.id
  for update of mi;

  with requested as (
    select menu_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 20
    group by menu_item_id
  )
  select count(*)::integer, coalesce(sum(mi.base_price * requested.quantity), 0)::bigint
  into v_valid_item_count, v_total
  from requested
  join public.menu_items mi on mi.id = requested.menu_item_id
  where mi.is_active = true
    and mi.is_available_today = true
    and mi.portion_type_id is not null;

  if v_valid_item_count <> v_requested_item_count or v_total <= 0 or v_total > 2147483647 then
    raise exception 'pos_item_unavailable_or_invalid';
  end if;

  if v_normalized_tender = 'cash' then
    if v_amount_received < v_total then
      raise exception 'insufficient_cash_received';
    end if;
  elsif v_amount_received <> v_total or v_reference is null then
    raise exception 'non_cash_tender_requires_exact_amount_and_reference';
  end if;

  v_change := v_amount_received - v_total::integer;

  insert into public.orders (
    customer_name, notes, status, payment_status, payment_provider,
    payment_reference, payment_last_verified_at, paid_at, service_date,
    promised_at, total_amount, order_source, cashier_profile_id
  ) values (
    'Walk-in customer', 'Walk-in POS sale', 'confirmed', 'paid', 'pos',
    v_reference, now(), now(), (now() at time zone 'Africa/Kampala')::date,
    now(), v_total::integer, 'pos', p_cashier_profile_id
  ) returning * into v_order;

  with requested as (
    select menu_item_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(menu_item_id bigint, quantity integer)
    where menu_item_id is not null and quantity between 1 and 20
    group by menu_item_id
  )
  insert into public.order_items (order_id, menu_item_id, menu_item_name, quantity, unit_price)
  select v_order.id, mi.id, mi.name, requested.quantity, mi.base_price
  from requested
  join public.menu_items mi on mi.id = requested.menu_item_id;

  perform public.reserve_paid_order_stock(v_order.id);

  insert into public.pos_tenders (
    order_id, tender_type, amount, amount_received, payment_reference, captured_by_profile_id
  ) values (
    v_order.id, v_normalized_tender, v_total::integer, v_amount_received, v_reference, p_cashier_profile_id
  );

  insert into public.order_status_events (order_id, event_type, from_status, to_status, note)
  values (v_order.id, 'status_changed', 'new', 'confirmed', 'Walk-in POS sale paid by ' || replace(v_normalized_tender, '_', ' ') || '.');

  insert into public.staff_activity_log (
    actor_profile_id, actor_email_snapshot, actor_role_snapshot, action,
    entity_type, entity_id, order_id, summary, metadata
  ) values (
    v_actor.id, v_actor.email, v_actor.role, 'pos.sale_created',
    'order', v_order.id::text, v_order.id,
    v_actor.email || ' created walk-in POS sale ' || v_order.order_number || '.',
    jsonb_build_object('tender_type', v_normalized_tender, 'total_amount', v_total, 'change_given', v_change)
  );

  update public.pos_sale_requests
  set order_id = v_order.id, completed_at = now()
  where idempotency_key = p_idempotency_key;

  return query
  select o.id, o.order_number, o.status, o.total_amount, t.tender_type, t.amount_received, t.change_given
  from public.orders o
  join public.pos_tenders t on t.order_id = o.id
  where o.id = v_order.id;
end;
$$;

revoke all on function public.create_pos_sale(uuid, text, uuid, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_pos_sale(uuid, text, uuid, text, integer, text, jsonb) to service_role;

commit;
