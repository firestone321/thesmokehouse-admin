begin;

-- Phase 52: DB-side analytics aggregation to replace JavaScript pagination.
-- The dashboard charts paginated all paid/created orders in 1k-page chunks
-- and aggregated in JS, burning Vercel CPU minutes on every render
-- (PS-PERF-07). These RPCs return per-hour or per-day aggregates already
-- bucketed in the Africa/Kampala business timezone so the JS layer only
-- has to map ~24 (today) or up to 365 (12m) rows into existing bucket and
-- day-value arrays.

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
    where status = 'completed'
      and payment_status = 'paid'
      and completed_at >= p_start
      and completed_at <  p_end
    group by 1
    order by 1;
  else
    return query
    select
      ((date_trunc('day', completed_at at time zone 'Africa/Kampala')) at time zone 'Africa/Kampala')::timestamptz as bucket_start,
      coalesce(sum(greatest(total_amount, 0))::bigint, 0) as value
    from public.orders
    where status = 'completed'
      and payment_status = 'paid'
      and completed_at >= p_start
      and completed_at <  p_end
    group by 1
    order by 1;
  end if;
end;
$$;

revoke execute on function public.get_analytics_revenue_aggregated(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.get_analytics_revenue_aggregated(timestamptz, timestamptz, text) to service_role;

create or replace function public.get_analytics_orders_aggregated(
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
      ((date_trunc('hour', created_at at time zone 'Africa/Kampala')) at time zone 'Africa/Kampala')::timestamptz as bucket_start,
      count(*)::bigint as value
    from public.orders
    where created_at >= p_start
      and created_at <  p_end
    group by 1
    order by 1;
  else
    return query
    select
      ((date_trunc('day', created_at at time zone 'Africa/Kampala')) at time zone 'Africa/Kampala')::timestamptz as bucket_start,
      count(*)::bigint as value
    from public.orders
    where created_at >= p_start
      and created_at <  p_end
    group by 1
    order by 1;
  end if;
end;
$$;

revoke execute on function public.get_analytics_orders_aggregated(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.get_analytics_orders_aggregated(timestamptz, timestamptz, text) to service_role;

commit;
