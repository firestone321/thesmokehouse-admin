begin;

-- Phase 44: read-only business truth health snapshot.
-- This is an admin/manager diagnostic surface. It does not repair data.
-- The application calls this with the service role and only renders it for
-- elevated admin roles, not regular staff order-flow users.

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
  daily_paid_totals as (
    select
      mi.portion_type_id,
      sum(
        case
          when o.payment_status = 'paid'
           and o.status <> 'completed'
           and o.status <> 'cancelled'
           and o.stock_reserved_at is not null
          then oi.quantity
          else 0
        end
      )::integer as expected_reserved_quantity,
      sum(
        case
          when o.payment_status = 'paid'
           and o.status = 'completed'
          then oi.quantity
          else 0
        end
      )::integer as expected_sold_quantity
    from public.orders o
    join public.order_items oi
      on oi.order_id = o.id
    join public.menu_items mi
      on mi.id = oi.menu_item_id
    join public.portion_types pt
      on pt.id = mi.portion_type_id
    where o.service_date = p_service_date
      and mi.portion_type_id is not null
      and pt.stock_source_portion_type_id is null
    group by mi.portion_type_id
  ),
  daily_stock_drift as (
    select
      ds.stock_date,
      ds.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      ds.reserved_quantity,
      coalesce(dpt.expected_reserved_quantity, 0) as expected_reserved_quantity,
      ds.sold_quantity,
      coalesce(dpt.expected_sold_quantity, 0) as expected_sold_quantity
    from public.daily_stock ds
    join public.portion_types pt
      on pt.id = ds.portion_type_id
    left join daily_paid_totals dpt
      on dpt.portion_type_id = ds.portion_type_id
    where ds.stock_date = p_service_date
      and (
        ds.reserved_quantity <> coalesce(dpt.expected_reserved_quantity, 0)
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
        'description', 'Today reserved/sold counts differ from paid reserved/completed orders.',
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
  'Returns read-only payment/stock/recovery reconciliation counts and previews for elevated admin diagnostics.';

commit;
