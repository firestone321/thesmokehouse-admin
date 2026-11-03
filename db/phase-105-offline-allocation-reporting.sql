-- Reporting only. No stock writes or financial ingestion.
-- Phase 3B must add atomic settlement before any server hold can be cleared.
begin;
create function public.get_pos_offline_allocation_holds(p_stock_date date)
returns table(portion_type_id bigint, held_quantity bigint)
language sql stable set search_path=public as $$
 select r.portion_type_id, sum(r.quantity_held)::bigint
 from public.pos_offline_allocation_resources r
 join public.pos_offline_allocations a on a.id=r.allocation_id
 where a.service_date=p_stock_date
 group by r.portion_type_id;
$$;
revoke all on function public.get_pos_offline_allocation_holds(date) from public,anon,authenticated;
grant execute on function public.get_pos_offline_allocation_holds(date) to service_role;
comment on function public.get_pos_offline_allocation_holds(date) is 'Physical source units. Includes expired grants: expiry or state alone is not settlement evidence. Local consumption remains held until Phase 3B validated settlement.';
-- Preserve the original OID and legacy return shape for SQL dependencies.
alter function public.get_daily_menu_stock(date) rename to get_daily_menu_stock_phase103_base;
revoke all on function public.get_daily_menu_stock_phase103_base(date) from public,anon,authenticated;
grant execute on function public.get_daily_menu_stock_phase103_base(date) to service_role;
create function public.get_daily_menu_stock(p_stock_date date)
returns table (
  stock_date date,
  portion_type_id bigint,
  portion_code text,
  portion_name text,
  portion_label text,
  protein_name text,
  packaging_type_name text,
  starting_quantity integer,
  reserved_quantity integer,
  sold_quantity integer,
  waste_quantity integer,
  remaining_quantity integer,
  is_initialized boolean,
  allocation_stock_portion_type_id bigint,
  offline_allocation_held_quantity bigint,
  stock_starting_quantity integer,
  stock_reserved_quantity integer,
  stock_sold_quantity integer,
  stock_waste_quantity integer,
  stock_remaining_quantity integer
)

language sql stable set search_path=public as $$
 select b.*, coalesce(pt.stock_source_portion_type_id,pt.id),
   coalesce(h.held_quantity,0),
   coalesce(ds.starting_quantity,fs.current_quantity,0),
   coalesce(ds.reserved_quantity,0), coalesce(ds.sold_quantity,0),
   coalesce(ds.waste_quantity,0),
   coalesce(ds.remaining_quantity,fs.current_quantity,0)
 from public.get_daily_menu_stock_phase103_base(p_stock_date) b
 join public.portion_types pt on pt.id=b.portion_type_id
 left join public.daily_stock ds
   on ds.portion_type_id=coalesce(pt.stock_source_portion_type_id,pt.id)
  and ds.stock_date=p_stock_date
 left join public.finished_stock fs
   on fs.portion_type_id=coalesce(pt.stock_source_portion_type_id,pt.id)
 left join public.get_pos_offline_allocation_holds(p_stock_date) h
   on h.portion_type_id=coalesce(pt.stock_source_portion_type_id,pt.id)
 order by pt.sort_order,pt.id;
$$;
revoke all on function public.get_daily_menu_stock(date) from public,anon,authenticated;
grant execute on function public.get_daily_menu_stock(date) to service_role;
comment on function public.get_daily_menu_stock(date) is 'Legacy per-serving fields preserved. Appended stock_* and allocation quantities use physical source units. Shared pools repeat across child rows: do not sum them. No inferred consumption or expiry release.';
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
      coalesce(pt.stock_source_portion_type_id, mi.portion_type_id) as portion_type_id,
      sum(
        case
          when o.payment_status = 'paid'
           and o.status <> 'cancelled'
           and o.stock_reservation_status = 'reserved'
          then oi.quantity * coalesce(pt.stock_source_units_per_serving, 1)
          else 0
        end
      )::integer as expected_reserved_quantity,
      sum(
        case
          when o.payment_status = 'paid'
           and o.stock_reservation_status = 'finalized'
          then oi.quantity * coalesce(pt.stock_source_units_per_serving, 1)
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
    group by coalesce(pt.stock_source_portion_type_id, mi.portion_type_id)
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



commit;
