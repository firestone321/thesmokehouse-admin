begin;

-- Phase 49: pickup code brute-force lockout state.
-- 4-digit pickup codes have a 10k key space; without a lockout an attacker
-- can script all 10k attempts. Track failed attempts on the order itself
-- (IP-based throttling is bypassable per PS-SEC-07) and cool down for 15
-- minutes after 5 wrong tries.

alter table public.orders
  add column if not exists pickup_code_failed_attempts integer not null default 0;

alter table public.orders
  add column if not exists pickup_code_locked_until timestamptz;

create or replace function public.register_pickup_code_failure(p_order_id bigint)
returns table (
  failed_attempts integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_threshold constant integer := 5;
  v_lockout_minutes constant integer := 15;
  v_attempts integer;
  v_locked_until timestamptz;
begin
  update public.orders
  set pickup_code_failed_attempts = pickup_code_failed_attempts + 1
  where id = p_order_id
  returning pickup_code_failed_attempts into v_attempts;

  if v_attempts is null then
    return;
  end if;

  if v_attempts >= v_threshold then
    update public.orders
    set pickup_code_failed_attempts = 0,
        pickup_code_locked_until = now() + (v_lockout_minutes::text || ' minutes')::interval
    where id = p_order_id
    returning pickup_code_locked_until into v_locked_until;

    return query select 0::integer, v_locked_until;
    return;
  end if;

  return query select v_attempts, null::timestamptz;
end;
$$;

revoke execute on function public.register_pickup_code_failure(bigint) from public, anon, authenticated;
grant execute on function public.register_pickup_code_failure(bigint) to service_role;

create or replace function public.clear_pickup_code_lock(p_order_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders
  set pickup_code_failed_attempts = 0,
      pickup_code_locked_until = null
  where id = p_order_id;
$$;

revoke execute on function public.clear_pickup_code_lock(bigint) from public, anon, authenticated;
grant execute on function public.clear_pickup_code_lock(bigint) to service_role;

commit;
