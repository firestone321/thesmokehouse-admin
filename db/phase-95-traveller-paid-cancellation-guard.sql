begin;

-- A POS tender has no refund ledger yet. Reject cancellation of a paid traveller
-- order instead of marking it cancelled while retaining payment and held stock.
create or replace function public.guard_paid_traveller_preorder_cancellation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled'
     and exists (select 1 from public.pos_traveller_preorders where order_id = old.id)
     and (old.payment_status = 'paid' or exists (
       select 1 from public.pos_tenders where order_id = old.id
     )) then
    raise exception 'paid_traveller_preorder_requires_refund_workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_paid_traveller_preorder_cancellation on public.orders;
create trigger orders_guard_paid_traveller_preorder_cancellation
before update of status on public.orders
for each row execute function public.guard_paid_traveller_preorder_cancellation();

create or replace function public.cancel_unpaid_pos_traveller_preorder(
  p_order_id bigint, p_staff_profile_id uuid
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_actor from public.profiles where id=p_staff_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role,'manager'::public.app_role,'cashier'::public.app_role,'staff'::public.app_role) then
    raise exception 'pos_access_denied';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or not exists (
    select 1 from public.pos_traveller_preorders where order_id=p_order_id
  ) then raise exception 'traveller_preorder_not_found'; end if;
  if v_order.status='cancelled' and v_order.payment_status='cancelled' then return v_order; end if;
  if v_order.status<>'new' or v_order.payment_status<>'pending'
     or v_order.stock_reservation_status<>'reserved' then
    raise exception 'only_unpaid_new_traveller_preorders_can_be_cancelled';
  end if;
  select * into v_order from public.transition_order_status(
    p_order_id,'cancelled','Unpaid traveller preorder cancelled; held stock released.');
  insert into public.staff_activity_log
    (actor_profile_id,actor_email_snapshot,actor_role_snapshot,action,
     entity_type,entity_id,order_id,summary,metadata)
  values (v_actor.id,v_actor.email,v_actor.role,'pos.traveller_preorder_cancelled',
    'order',p_order_id::text,p_order_id,
    v_actor.email || ' cancelled unpaid traveller preorder ' || v_order.order_number || '.',
    '{}'::jsonb);
  return v_order;
end;
$$;
revoke all on function public.cancel_unpaid_pos_traveller_preorder(bigint,uuid) from public,anon,authenticated;
grant execute on function public.cancel_unpaid_pos_traveller_preorder(bigint,uuid) to service_role;
commit;