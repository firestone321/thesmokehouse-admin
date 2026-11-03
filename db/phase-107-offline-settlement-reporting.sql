-- Phase 3B: immutable resource evidence, close serialization and order protection.
begin;
create or replace function public.get_business_truth_health_snapshot(
  p_now timestamptz default now(),
  p_service_date date default current_date
)
returns table (
  generated_at timestamptz,
  critical_count integer,
  warning_count integer,
  sections jsonb
)
language sql
stable
as $$
  with
  paid_missing_stock as (
    select
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.stock_reservation_status,
      o.stock_reservation_error,
      o.created_at
    from public.orders o
    where o.payment_status = 'paid'
      and o.status <> 'cancelled'
      and o.stock_reserved_at is null
      and coalesce(o.stock_reservation_status, 'not_started') not in ('reserved', 'finalized')
    order by o.created_at desc
  ),
  unpaid_in_kitchen as (
    select
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.created_at
    from public.orders o
    where coalesce(o.payment_status, 'pending') <> 'paid'
      and o.status in ('confirmed', 'in_prep', 'ready', 'completed')
    order by o.created_at desc
  ),
  paid_not_in_flow as (
    select
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.fulfillment_review_required,
      o.fulfillment_review_reason,
      o.created_at
    from public.orders o
    where o.payment_status = 'paid'
      and o.status in ('new', 'cancelled')
      and coalesce(o.fulfillment_review_required, false) = false
    order by o.created_at desc
  ),
  cancelled_provider_paid as (
    select distinct
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      pa.provider,
      pa.provider_reference,
      pa.verified_at,
      o.created_at
    from public.orders o
    join public.payment_attempts pa
      on pa.order_id = o.id
    where (o.status = 'cancelled' or o.payment_status = 'cancelled')
      and pa.payment_status = 'paid'
    order by o.created_at desc
  ),
  stale_payment_recoveries as (
    select
      r.id,
      r.order_id,
      o.order_number,
      r.status,
      r.attempt_count,
      r.next_attempt_at,
      r.locked_at,
      r.last_error
    from public.pending_payment_recoveries r
    left join public.orders o
      on o.id = r.order_id
    where r.completed_at is null
      and (
        r.next_attempt_at <= p_now - interval '5 minutes'
        or r.locked_at <= p_now - interval '5 minutes'
        or r.status = 'failed'
      )
    order by coalesce(r.next_attempt_at, r.created_at) asc
  ),
  latest_finished_movements as (
    select distinct on (fsm.portion_type_id)
      fsm.portion_type_id,
      fsm.resulting_quantity,
      fsm.created_at
    from public.finished_stock_movements fsm
    order by fsm.portion_type_id, fsm.created_at desc, fsm.id desc
  ),
  finished_stock_drift as (
    select
      fs.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      fs.current_quantity,
      lfm.resulting_quantity as movement_quantity,
      lfm.created_at as last_movement_at
    from public.finished_stock fs
    join public.portion_types pt
      on pt.id = fs.portion_type_id
    left join latest_finished_movements lfm
      on lfm.portion_type_id = fs.portion_type_id
    where lfm.portion_type_id is not null
      and fs.current_quantity <> lfm.resulting_quantity
    order by abs(fs.current_quantity - lfm.resulting_quantity) desc, pt.sort_order, pt.id
  ),
  paid_stock_lines as (
    select coalesce(pt.stock_source_portion_type_id,mi.portion_type_id) portion_type_id,
      oi.quantity*coalesce(pt.stock_source_units_per_serving,1) quantity,o.payment_status,o.status,o.stock_reservation_status
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.menu_items mi on mi.id=oi.menu_item_id join public.portion_types pt on pt.id=mi.portion_type_id
    where o.service_date=p_service_date and not exists(select 1 from public.pos_offline_ingestions i where i.order_id=o.id)
    union all
    select s.portion_type_id,s.quantity,o.payment_status,o.status,o.stock_reservation_status
    from public.pos_offline_stock_settlements s join public.orders o on o.id=s.order_id where o.service_date=p_service_date
  ),
  daily_paid_totals as (
    select portion_type_id,sum(case when payment_status='paid' and status<>'cancelled' and stock_reservation_status='reserved' then quantity else 0 end)::integer expected_reserved_quantity,
    sum(case when payment_status='paid' and status<>'cancelled' and stock_reservation_status='finalized' then quantity else 0 end)::integer expected_sold_quantity
    from paid_stock_lines group by portion_type_id
  ),
  offline_holds as (
    select * from public.get_pos_offline_allocation_holds(p_service_date)
  ),
  daily_stock_drift as (
    select
      ds.stock_date,
      ds.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      ds.reserved_quantity,
      coalesce(dpt.expected_reserved_quantity, 0) as expected_paid_reserved_quantity,
      coalesce(oh.held_quantity, 0) as offline_allocation_held_quantity,
      coalesce(dpt.expected_reserved_quantity, 0) + coalesce(oh.held_quantity, 0) as expected_reserved_quantity,
      ds.sold_quantity,
      coalesce(dpt.expected_sold_quantity, 0) as expected_sold_quantity
    from public.daily_stock ds
    join public.portion_types pt
      on pt.id = ds.portion_type_id
    left join daily_paid_totals dpt
      on dpt.portion_type_id = ds.portion_type_id
    left join offline_holds oh on oh.portion_type_id = ds.portion_type_id
    where ds.stock_date = p_service_date
      and (
        ds.reserved_quantity <> coalesce(dpt.expected_reserved_quantity, 0) + coalesce(oh.held_quantity, 0)
        or ds.sold_quantity <> coalesce(dpt.expected_sold_quantity, 0)
      )
    order by pt.sort_order, pt.id
  ),
  negative_or_zero_truth as (
    select
      fs.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      fs.current_quantity
    from public.finished_stock fs
    join public.portion_types pt
      on pt.id = fs.portion_type_id
    where fs.current_quantity < 0
    order by fs.current_quantity asc, pt.sort_order, pt.id
  ),
  counts as (
    select
      (select count(*) from paid_missing_stock) as paid_missing_stock_count,
      (select count(*) from unpaid_in_kitchen) as unpaid_in_kitchen_count,
      (select count(*) from paid_not_in_flow) as paid_not_in_flow_count,
      (select count(*) from cancelled_provider_paid) as cancelled_provider_paid_count,
      (select count(*) from stale_payment_recoveries) as stale_payment_recoveries_count,
      (select count(*) from finished_stock_drift) as finished_stock_drift_count,
      (select count(*) from daily_stock_drift) as daily_stock_drift_count,
      (select count(*) from negative_or_zero_truth) as negative_stock_count
  )
  select
    p_now as generated_at,
    (
      c.paid_missing_stock_count
      + c.unpaid_in_kitchen_count
      + c.paid_not_in_flow_count
      + c.cancelled_provider_paid_count
      + c.finished_stock_drift_count
      + c.daily_stock_drift_count
      + c.negative_stock_count
    )::integer as critical_count,
    c.stale_payment_recoveries_count::integer as warning_count,
    jsonb_build_array(
      jsonb_build_object(
        'key', 'paid_missing_stock',
        'title', 'Paid orders missing stock reservation',
        'severity', 'critical',
        'count', c.paid_missing_stock_count,
        'description', 'Paid orders that have not reserved/finalized stock.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from paid_missing_stock limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'unpaid_in_kitchen',
        'title', 'Unpaid orders in kitchen flow',
        'severity', 'critical',
        'count', c.unpaid_in_kitchen_count,
        'description', 'Orders not marked paid but already confirmed, in prep, ready, or completed.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from unpaid_in_kitchen limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'paid_not_in_flow',
        'title', 'Paid orders outside staff flow',
        'severity', 'critical',
        'count', c.paid_not_in_flow_count,
        'description', 'Paid orders still new/cancelled without fulfillment review.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from paid_not_in_flow limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'cancelled_provider_paid',
        'title', 'Cancelled local orders with paid provider attempt',
        'severity', 'critical',
        'count', c.cancelled_provider_paid_count,
        'description', 'Local cancellation conflicts with provider-paid evidence.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from cancelled_provider_paid limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'finished_stock_drift',
        'title', 'Finished stock differs from latest movement',
        'severity', 'critical',
        'count', c.finished_stock_drift_count,
        'description', 'Durable stock balance does not match the latest movement result.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from finished_stock_drift limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'daily_stock_drift',
        'title', 'Daily stock differs from paid order totals',
        'severity', 'critical',
        'count', c.daily_stock_drift_count,
        'description', 'Service-day reserved/sold counts differ from paid orders plus separately funded offline holds.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from daily_stock_drift limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'negative_stock',
        'title', 'Negative finished stock',
        'severity', 'critical',
        'count', c.negative_stock_count,
        'description', 'Finished stock quantity is below zero.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from negative_or_zero_truth limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'stale_payment_recoveries',
        'title', 'Stale pending payment recoveries',
        'severity', 'warning',
        'count', c.stale_payment_recoveries_count,
        'description', 'Recovery rows are due, stalled, or failed.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from stale_payment_recoveries limit 10) row), '[]'::jsonb)
      )
    ) as sections
  from counts c;
$$;

revoke execute on function public.get_business_truth_health_snapshot(timestamptz, date)
from public, anon, authenticated;
grant execute on function public.get_business_truth_health_snapshot(timestamptz, date)
to service_role;

comment on function public.get_business_truth_health_snapshot(timestamptz, date) is
  'Returns read-only payment/stock/recovery reconciliation counts and previews; Phase 79 classifies reserved versus sold orders by stock reservation state.';




CREATE OR REPLACE FUNCTION public.sign_off_daily_close_v2(p_service_date date, p_opening_cash_ugx bigint, p_actual_cash_counted_ugx bigint, p_notes text, p_closed_by uuid, p_snapshot jsonb) RETURNS TABLE(snapshot_id uuid, expected_cash_ugx bigint, variance_ugx bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor public.profiles%rowtype;
  v_reconciliation record;
  v_snapshot_id uuid;
  v_variance bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('offline-close:'||p_service_date::text,106));
  if p_service_date is null or p_opening_cash_ugx is null or p_opening_cash_ugx < 0
     or p_actual_cash_counted_ugx is null or p_actual_cash_counted_ugx < 0 then
    raise exception 'daily_close_cash_values_invalid';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'daily_close_notes_too_long'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'daily_close_snapshot_invalid'; end if;

  select * into v_actor from public.profiles where id = p_closed_by;
  if not found or v_actor.role not in ('admin', 'manager') then raise exception 'daily_close_actor_not_authorized'; end if;

  select * into v_reconciliation
  from public.get_daily_cash_reconciliation(p_service_date, p_opening_cash_ugx);
  v_variance := p_actual_cash_counted_ugx - v_reconciliation.expected_cash_ugx;

  insert into public.daily_close_snapshots (
    service_date, closed_by_profile_id, closed_by_email_snapshot, closed_by_role_snapshot,
    opening_float_ugx, cash_counted_ugx, expected_pos_cash_ugx, cash_difference_ugx,
    expected_cash_ugx, cash_money_out_ugx, cash_transfers_out_ugx,
    cash_transfers_in_ugx, deposit_expected, mobile_money_deposit_recorded,
    counted_by_profile_id, counted_at, snapshot, notes
  ) values (
    p_service_date, v_actor.id, v_actor.email, v_actor.role,
    p_opening_cash_ugx, p_actual_cash_counted_ugx, v_reconciliation.cash_sales_ugx, v_variance,
    v_reconciliation.expected_cash_ugx, v_reconciliation.cash_money_out_ugx,
    v_reconciliation.cash_transfers_out_ugx, v_reconciliation.cash_transfers_in_ugx,
    v_reconciliation.cash_activity_exists, v_reconciliation.mobile_money_deposit_recorded,
    v_actor.id, now(),
    p_snapshot || jsonb_build_object(
      'cashReconciliation', jsonb_build_object(
        'openingCashUgx', p_opening_cash_ugx,
        'cashSalesUgx', v_reconciliation.cash_sales_ugx,
        'cashMoneyOutUgx', v_reconciliation.cash_money_out_ugx,
        'cashTransfersOutUgx', v_reconciliation.cash_transfers_out_ugx,
        'cashTransfersInUgx', v_reconciliation.cash_transfers_in_ugx,
        'expectedCashUgx', v_reconciliation.expected_cash_ugx,
        'actualCashCountedUgx', p_actual_cash_counted_ugx,
        'varianceUgx', v_variance,
        'mobileMoneyDepositRecorded', v_reconciliation.mobile_money_deposit_recorded
      )
    ),
    nullif(btrim(coalesce(p_notes, '')), '')
  ) returning id into v_snapshot_id;

  insert into public.staff_activity_log (
    actor_profile_id, actor_email_snapshot, actor_role_snapshot, action,
    entity_type, entity_id, summary, metadata
  ) values (
    v_actor.id, v_actor.email, v_actor.role, 'daily_close.signed_off',
    'daily_close_snapshot', v_snapshot_id::text,
    coalesce(v_actor.email, 'Unknown manager') || ' signed off Daily Close for ' || p_service_date::text || '.',
    jsonb_build_object(
      'serviceDate', p_service_date, 'openingCashUgx', p_opening_cash_ugx,
      'actualCashCountedUgx', p_actual_cash_counted_ugx,
      'expectedCashUgx', v_reconciliation.expected_cash_ugx,
      'varianceUgx', v_variance
    )
  );

  return query select v_snapshot_id, v_reconciliation.expected_cash_ugx, v_variance;
end;
$$;

create function public.guard_ingested_offline_order() returns trigger language plpgsql security definer set search_path=public as $$
declare v_order_id bigint;
begin
 if tg_table_name='orders' then
   v_order_id:=old.id;
   if exists(select 1 from public.pos_offline_ingestions where order_id=v_order_id and acknowledgement is not null) and
     ((to_jsonb(new)-'updated_at'-'fulfillment_review_required'-'fulfillment_review_reason') is distinct from (to_jsonb(old)-'updated_at'-'fulfillment_review_required'-'fulfillment_review_reason') or
      (new.fulfillment_review_required is not distinct from old.fulfillment_review_required and new.fulfillment_review_reason is not distinct from old.fulfillment_review_reason)) then
     raise exception 'ingested_offline_order_is_immutable'; end if;
   return new;
 end if;
 if tg_op='INSERT' then v_order_id:=new.order_id; else v_order_id:=old.order_id; end if;
 if exists(select 1 from public.pos_offline_ingestions where order_id=v_order_id and acknowledgement is not null) then
   raise exception 'ingested_offline_order_is_immutable'; end if;
 if tg_op='UPDATE' and exists(select 1 from public.pos_offline_ingestions where order_id=new.order_id and acknowledgement is not null) then
   raise exception 'ingested_offline_order_is_immutable'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create trigger ingested_offline_order_guard before update on public.orders for each row execute function public.guard_ingested_offline_order();
create trigger ingested_offline_items_guard before insert or update or delete on public.order_items for each row execute function public.guard_ingested_offline_order();
create trigger ingested_offline_tender_guard before insert or update or delete on public.pos_tenders for each row execute function public.guard_ingested_offline_order();
revoke all on function public.guard_ingested_offline_order() from public,anon,authenticated;
commit;
