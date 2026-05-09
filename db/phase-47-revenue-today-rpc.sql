begin;

create or replace function public.get_revenue_today_total(
  p_start timestamptz,
  p_end   timestamptz
)
returns bigint
language sql
stable
as $$
  select coalesce(sum(total_amount), 0)::bigint
  from public.orders
  where payment_status = 'paid'
    and paid_at >= p_start
    and paid_at <  p_end
$$;

revoke execute on function public.get_revenue_today_total(timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.get_revenue_today_total(timestamptz, timestamptz) to service_role;

commit;
