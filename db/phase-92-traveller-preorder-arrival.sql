begin;

create or replace function public.pay_pos_traveller_preorder(
  p_order_id bigint,
  p_cashier_profile_id uuid,
  p_tender_type text,
  p_amount_received integer,
  p_payment_reference text
)
returns table (
  id bigint, order_number text, status text, payment_status text,
  total_amount integer, tender_type text, amount_received integer,
  change_given integer, promised_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_preorder public.pos_traveller_preorders%rowtype;
  v_actor public.profiles%rowtype;
  v_existing_tender public.pos_tenders%rowtype;
  v_tender text := lower(btrim(coalesce(p_tender_type,'')));
  v_reference text := nullif(btrim(coalesce(p_payment_reference,'')), '');
begin
  select * into v_actor from public.profiles profile where profile.id = p_cashier_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'cashier'::public.app_role,'staff'::public.app_role) then
    raise exception 'pos_access_denied';
  end if;
  select * into v_order from public.orders where orders.id = p_order_id for update;
  select * into v_preorder from public.pos_traveller_preorders where order_id = p_order_id for update;
  if v_order.id is null or v_preorder.order_id is null or v_preorder.payment_timing <> 'arrival' then
    raise exception 'pay_on_arrival_preorder_not_found';
  end if;
  if v_tender not in ('cash','mobile_money','card') then raise exception 'invalid_pos_tender'; end if;
  if v_tender = 'cash' then
    if p_amount_received is null or p_amount_received < v_order.total_amount then
      raise exception 'insufficient_cash_received';
    end if;
  elsif p_amount_received <> v_order.total_amount or v_reference is null then
    raise exception 'non_cash_tender_requires_exact_amount_and_reference';
  end if;
  select * into v_existing_tender from public.pos_tenders where order_id = p_order_id;
  if found then
    if v_order.payment_status <> 'paid' or v_existing_tender.tender_type <> v_tender
       or v_existing_tender.amount_received <> p_amount_received
       or v_existing_tender.payment_reference is distinct from v_reference then
      raise exception 'preorder_already_paid_with_different_tender';
    end if;
    return query select o.id,o.order_number,o.status,o.payment_status,o.total_amount,
      t.tender_type,t.amount_received,t.change_given,o.promised_at
    from public.orders o join public.pos_tenders t on t.order_id=o.id where o.id=p_order_id;
    return;
  end if;
  if v_order.status <> 'new' or v_order.payment_status <> 'pending'
     or v_order.stock_reservation_status <> 'reserved' or v_order.stock_reserved_at is null then
    raise exception 'preorder_not_ready_for_arrival_payment';
  end if;
  insert into public.pos_tenders
    (order_id,tender_type,amount,amount_received,payment_reference,captured_by_profile_id)
  values (p_order_id,v_tender,v_order.total_amount,p_amount_received,v_reference,p_cashier_profile_id);
  update public.orders set
    payment_status='paid', payment_provider='pos', payment_reference=v_reference,
    payment_last_verified_at=now(), paid_at=now(), status='confirmed'
  where orders.id=p_order_id returning * into v_order;
  update public.pos_traveller_preorders set checked_in_at=now() where order_id=p_order_id;
  insert into public.order_status_events(order_id,event_type,from_status,to_status,note)
  values (p_order_id,'status_changed','new','confirmed','Traveller preorder paid on arrival and sent to kitchen.');
  insert into public.staff_activity_log
    (actor_profile_id,actor_email_snapshot,actor_role_snapshot,action,
     entity_type,entity_id,order_id,summary,metadata)
  values (v_actor.id,v_actor.email,v_actor.role,'pos.traveller_preorder_paid',
    'order',p_order_id::text,p_order_id,
    v_actor.email || ' took arrival payment for preorder ' || v_order.order_number || '.',
    jsonb_build_object('tender_type',v_tender,'amount',v_order.total_amount));
  return query select o.id,o.order_number,o.status,o.payment_status,o.total_amount,
    t.tender_type,t.amount_received,t.change_given,o.promised_at
  from public.orders o join public.pos_tenders t on t.order_id=o.id where o.id=p_order_id;
end;
$$;

create or replace function public.check_in_paid_pos_traveller_preorder(
  p_order_id bigint, p_staff_profile_id uuid
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_preorder public.pos_traveller_preorders%rowtype;
  v_actor public.profiles%rowtype;
begin
  select * into v_actor from public.profiles where id=p_staff_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'cashier'::public.app_role,'staff'::public.app_role) then
    raise exception 'pos_access_denied';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  select * into v_preorder from public.pos_traveller_preorders where order_id=p_order_id for update;
  if v_order.id is null or v_preorder.order_id is null or v_preorder.payment_timing <> 'booking' then
    raise exception 'paid_at_booking_preorder_not_found';
  end if;
  if v_order.status='confirmed' and v_preorder.checked_in_at is not null then return v_order; end if;
  if v_order.status <> 'new' or v_order.payment_status <> 'paid'
     or v_order.stock_reservation_status <> 'reserved' or v_order.stock_reserved_at is null then
    raise exception 'preorder_not_ready_for_check_in';
  end if;
  update public.orders set status='confirmed' where id=p_order_id returning * into v_order;
  update public.pos_traveller_preorders set checked_in_at=now() where order_id=p_order_id;
  insert into public.order_status_events(order_id,event_type,from_status,to_status,note)
  values (p_order_id,'status_changed','new','confirmed','Paid traveller preorder checked in and sent to kitchen.');
  insert into public.staff_activity_log
    (actor_profile_id,actor_email_snapshot,actor_role_snapshot,action,
     entity_type,entity_id,order_id,summary,metadata)
  values (v_actor.id,v_actor.email,v_actor.role,'pos.traveller_preorder_checked_in',
    'order',p_order_id::text,p_order_id,
    v_actor.email || ' checked in traveller preorder ' || v_order.order_number || '.',
    jsonb_build_object('arrival_at',v_order.promised_at));
  return v_order;
end;
$$;

revoke all on function public.pay_pos_traveller_preorder(bigint,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.pay_pos_traveller_preorder(bigint,uuid,text,integer,text) to service_role;
revoke all on function public.check_in_paid_pos_traveller_preorder(bigint,uuid) from public,anon,authenticated;
grant execute on function public.check_in_paid_pos_traveller_preorder(bigint,uuid) to service_role;
commit;
