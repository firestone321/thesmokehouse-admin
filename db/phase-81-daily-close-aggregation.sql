-- Phase 81: aggregate Daily Close data in PostgreSQL.
-- This removes client-side row caps while preserving the existing report rules.

begin;

create or replace function public.get_daily_close_summary(p_service_date date)
returns table (
  total_sales bigint,
  pos_sales bigint,
  online_sales bigint,
  completed_paid_sales bigint,
  completed_orders bigint,
  cancelled_orders bigint,
  pending_payment_orders bigint,
  open_paid_orders jsonb,
  pos_tenders jsonb,
  expected_pos_cash bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with day_orders as materialized (
    select
      o.id,
      o.order_number,
      o.order_source,
      o.status,
      o.payment_status,
      o.total_amount,
      o.created_at
    from public.orders o
    where o.service_date = p_service_date
  ),
  order_summary as (
    select
      coalesce(sum(o.total_amount) filter (
        where o.payment_status = 'paid' and o.status <> 'cancelled'
      ), 0)::bigint as total_sales,
      coalesce(sum(o.total_amount) filter (
        where o.payment_status = 'paid'
          and o.status <> 'cancelled'
          and o.order_source = 'pos'
      ), 0)::bigint as pos_sales,
      coalesce(sum(o.total_amount) filter (
        where o.payment_status = 'paid'
          and o.status <> 'cancelled'
          and o.order_source = 'storefront'
      ), 0)::bigint as online_sales,
      coalesce(sum(o.total_amount) filter (
        where o.payment_status = 'paid'
          and (
            o.status = 'completed'
            or (o.order_source = 'pos' and o.status = 'ready')
          )
      ), 0)::bigint as completed_paid_sales,
      count(*) filter (
        where o.payment_status = 'paid'
          and (
            o.status = 'completed'
            or (o.order_source = 'pos' and o.status = 'ready')
          )
      )::bigint as completed_orders,
      count(*) filter (where o.status = 'cancelled')::bigint as cancelled_orders,
      count(*) filter (
        where o.status <> 'cancelled'
          and coalesce(o.payment_status, '') <> 'paid'
      )::bigint as pending_payment_orders
    from day_orders o
  ),
  open_paid as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'order_number', o.order_number,
          'order_source', o.order_source,
          'status', o.status,
          'payment_status', o.payment_status,
          'total_amount', o.total_amount
        ) order by o.created_at desc, o.id desc
      ),
      '[]'::jsonb
    ) as orders
    from (
      select *
      from day_orders
      where payment_status = 'paid'
        and status <> 'cancelled'
        and not (
          status = 'completed'
          or (order_source = 'pos' and status = 'ready')
        )
      order by created_at desc, id desc
      limit 12
    ) o
  ),
  tender_summary as (
    select
      t.tender_type,
      count(*)::bigint as sale_count,
      coalesce(sum(t.amount), 0)::bigint as amount,
      coalesce(sum(t.amount_received), 0)::bigint as received,
      coalesce(sum(t.change_given), 0)::bigint as change
    from public.pos_tenders t
    join day_orders o on o.id = t.order_id
    where o.order_source = 'pos'
      and o.payment_status = 'paid'
      and o.status <> 'cancelled'
    group by t.tender_type
  ),
  tenders as (
    select jsonb_agg(
      jsonb_build_object(
        'type', tender_type.type,
        'count', coalesce(tender_summary.sale_count, 0),
        'amount', coalesce(tender_summary.amount, 0),
        'received', coalesce(tender_summary.received, 0),
        'change', coalesce(tender_summary.change, 0)
      ) order by tender_type.sort_order
    ) as rows
    from (values
      ('cash'::text, 1),
      ('mobile_money'::text, 2),
      ('card'::text, 3)
    ) as tender_type(type, sort_order)
    left join tender_summary on tender_summary.tender_type = tender_type.type
  )
  select
    order_summary.total_sales,
    order_summary.pos_sales,
    order_summary.online_sales,
    order_summary.completed_paid_sales,
    order_summary.completed_orders,
    order_summary.cancelled_orders,
    order_summary.pending_payment_orders,
    open_paid.orders,
    tenders.rows,
    coalesce((
      select tender_summary.amount
      from tender_summary
      where tender_summary.tender_type = 'cash'
    ), 0)::bigint as expected_pos_cash
  from order_summary
  cross join open_paid
  cross join tenders;
$$;

revoke all
  on function public.get_daily_close_summary(date)
  from public, anon, authenticated;
grant execute
  on function public.get_daily_close_summary(date)
  to service_role;

comment on function public.get_daily_close_summary(date) is
  'Returns uncapped Daily Close aggregates plus at most 12 newest open paid orders. POS Ready is terminal; storefront Ready remains open.';

commit;
