begin;

-- Phase 79: Ready is the terminal state for walk-in POS orders.
-- Keep stock and reporting semantics aligned with that simplified lifecycle:
--
-- 1. get_daily_menu_stock classifies reserved and sold quantities using the
--    durable stock_reservation_status instead of requiring status=completed.
--
-- 2. get_business_truth_health_snapshot uses the same durable stock state so a
--    terminal Ready POS order cannot create a false reconciliation alert.
-- 3. transition_order_status finalizes POS stock and completed_at at Ready, but
--    preserves Ready as the visible status and blocks a redundant next step.
-- 4. revenue aggregation uses completed_at so terminal POS Ready sales count.

do $$
begin
  if exists (
    select 1
    from public.orders
    where order_source = 'pos'
      and status = 'ready'
      and coalesce(stock_reservation_status, 'not_started') <> 'finalized'
  ) then
    raise exception 'phase_79_pos_ready_backfill_required';
  end if;
end;
$$;

create or replace function public.get_daily_menu_stock(p_stock_date date)
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
  is_initialized boolean
)
language sql
stable
as $$
  with order_item_totals as (
    select
      mi.portion_type_id,
      sum(
        case
          when o.payment_status = 'paid'
           and o.status <> 'cancelled'
           and o.stock_reservation_status = 'reserved'
          then oi.quantity
          else 0
        end
      )::integer as reserved_quantity,
      sum(
        case
          when o.payment_status = 'paid'
           and o.stock_reservation_status = 'finalized'
          then oi.quantity
          else 0
        end
      )::integer as sold_quantity
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.menu_items mi on mi.id = oi.menu_item_id
    where o.service_date = p_stock_date
      and o.payment_status = 'paid'
      and o.status <> 'cancelled'
      and mi.portion_type_id is not null
    group by mi.portion_type_id
  )
  select
    p_stock_date as stock_date,
    pt.id as portion_type_id,
    pt.code as portion_code,
    pt.name as portion_name,
    pt.portion_label,
    pr.name as protein_name,
    pkg.name as packaging_type_name,
    case
      when pt.stock_source_portion_type_id is not null
      then floor(coalesce(src_ds.starting_quantity, src_fs.current_quantity, 0)::numeric / pt.stock_source_units_per_serving)::integer
      else coalesce(ds.starting_quantity, fs.current_quantity, 0)
    end as starting_quantity,
    coalesce(ot.reserved_quantity, 0) as reserved_quantity,
    coalesce(ot.sold_quantity, 0) as sold_quantity,
    case
      when pt.stock_source_portion_type_id is not null then 0
      else coalesce(ds.waste_quantity, 0)
    end as waste_quantity,
    case
      when pt.stock_source_portion_type_id is not null
      then floor(coalesce(src_ds.remaining_quantity, src_fs.current_quantity, 0)::numeric / pt.stock_source_units_per_serving)::integer
      else coalesce(ds.remaining_quantity, fs.current_quantity, 0)
    end as remaining_quantity,
    case
      when pt.stock_source_portion_type_id is not null then (src_ds.portion_type_id is not null)
      else (ds.portion_type_id is not null)
    end as is_initialized
  from public.portion_types pt
  left join public.proteins pr
    on pr.id = pt.protein_id
  left join public.packaging_types pkg
    on pkg.id = pt.packaging_type_id
  left join public.daily_stock ds
    on ds.portion_type_id = pt.id
   and ds.stock_date = p_stock_date
  left join public.daily_stock src_ds
    on src_ds.portion_type_id = pt.stock_source_portion_type_id
   and src_ds.stock_date = p_stock_date
  left join public.finished_stock fs
    on fs.portion_type_id = pt.id
  left join public.finished_stock src_fs
    on src_fs.portion_type_id = pt.stock_source_portion_type_id
  left join order_item_totals ot
    on ot.portion_type_id = pt.id
  where pt.is_active = true
  order by pt.sort_order, pt.id;
$$;

comment on function public.get_daily_menu_stock(date) is
  'Returns active menu portions for a service day. Reserved/sold counts are per portion (from order_items) so shared-source portions (e.g. fries_250g and large_fries) no longer overlap. starting/remaining still derive from the shared physical pool.';

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
        'description', 'Today reserved/sold counts differ from paid reserved/finalized orders.',
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


create or replace function public.transition_order_status(
  p_order_id bigint,
  p_to_status text,
  p_note text default null
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_from_status text;
  v_valid boolean := false;
  v_is_pos_terminal boolean := false;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  v_from_status := v_order.status;
  v_is_pos_terminal := v_order.order_source = 'pos' and p_to_status = 'ready';

  v_valid := case
    when v_from_status = 'new' and p_to_status = 'cancelled' then true
    when v_from_status = 'confirmed' and p_to_status in ('in_prep', 'cancelled') then true
    when v_from_status = 'in_prep' and p_to_status in ('ready', 'cancelled') then true
    when v_from_status = 'ready'
      and v_order.order_source <> 'pos'
      and p_to_status in ('completed', 'cancelled') then true
    else false
  end;

  if not v_valid then
    raise exception 'Invalid order status transition from % to %', v_from_status, p_to_status;
  end if;

  if p_to_status in ('confirmed', 'in_prep', 'ready', 'completed') and v_order.payment_status <> 'paid' then
    raise exception 'Only paid orders can move to %', p_to_status;
  end if;

  if p_to_status in ('in_prep', 'ready', 'completed') and v_order.fulfillment_review_required then
    raise exception 'This paid order requires fulfillment review before moving to %', p_to_status;
  end if;

  if p_to_status in ('in_prep', 'ready', 'completed') and v_order.stock_reserved_at is null then
    raise exception 'This paid order does not have reserved stock yet';
  end if;

  if p_to_status = 'cancelled' and v_order.stock_reserved_at is not null then
    select *
    into v_order
    from public.release_reserved_order_stock(p_order_id);
  end if;

  if p_to_status = 'completed' or v_is_pos_terminal then
    select *
    into v_order
    from public.finalize_reserved_order_sale(p_order_id);
  end if;

  update public.orders
  set
    status = p_to_status,
    payment_status = case
      when p_to_status = 'cancelled' and payment_status <> 'paid' then 'cancelled'
      else payment_status
    end,
    completed_at = case
      when p_to_status = 'completed' or v_is_pos_terminal then coalesce(completed_at, now())
      else completed_at
    end,
    cancelled_at = case when p_to_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
  where id = p_order_id
  returning *
  into v_order;

  insert into public.order_status_events (
    order_id,
    event_type,
    from_status,
    to_status,
    note
  )
  values (
    v_order.id,
    'status_changed',
    v_from_status,
    p_to_status,
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return v_order;
end;
$$;

create or replace function public.get_analytics_revenue_aggregated(
  p_start timestamptz,
  p_end   timestamptz,
  p_grain text
)
returns table(bucket_start timestamptz, value bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_grain = 'hour' then
    return query
    select
      ((date_trunc('hour', completed_at at time zone 'Africa/Kampala')) at time zone 'Africa/Kampala')::timestamptz as bucket_start,
      coalesce(sum(greatest(total_amount, 0))::bigint, 0) as value
    from public.orders
    where completed_at is not null
      and status <> 'cancelled'
      and payment_status = 'paid'
      and completed_at >= p_start
      and completed_at < p_end
    group by 1
    order by 1;
  else
    return query
    select
      ((date_trunc('day', completed_at at time zone 'Africa/Kampala')) at time zone 'Africa/Kampala')::timestamptz as bucket_start,
      coalesce(sum(greatest(total_amount, 0))::bigint, 0) as value
    from public.orders
    where completed_at is not null
      and status <> 'cancelled'
      and payment_status = 'paid'
      and completed_at >= p_start
      and completed_at < p_end
    group by 1
    order by 1;
  end if;
end;
$$;

revoke execute on function public.get_analytics_revenue_aggregated(timestamptz, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.get_analytics_revenue_aggregated(timestamptz, timestamptz, text)
to service_role;

comment on function public.transition_order_status(bigint, text, text) is
  'Moves storefront orders through pickup completion and treats Ready as the final fulfilled state for walk-in POS orders.';

comment on function public.get_analytics_revenue_aggregated(timestamptz, timestamptz, text) is
  'Aggregates paid fulfilled revenue by completed_at, including terminal Ready walk-in POS orders.';

commit;
