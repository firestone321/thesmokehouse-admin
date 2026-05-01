begin;

-- Phase 30: make customer push subscriptions device-scoped and keep admin
-- paid-order dispatches retryable when staff devices are not yet subscribed.

alter table public.push_subscriptions
  add column if not exists device_id text,
  add column if not exists last_seen_at timestamptz;

create index if not exists push_subscriptions_device_id_idx
  on public.push_subscriptions (device_id)
  where device_id is not null;

create or replace function public.claim_admin_push_dispatches(
  p_limit integer default 10,
  p_order_id bigint default null
)
returns setof public.admin_push_dispatches
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  return query
  with candidates as (
    select d.id
    from public.admin_push_dispatches d
    where (
      (
        d.status in ('pending', 'no_subscribers')
        and d.next_attempt_at <= now()
      )
      or (
        d.status = 'processing'
        and d.last_attempt_at is not null
        and d.last_attempt_at <= now() - interval '5 minutes'
      )
    )
    and (p_order_id is null or d.order_id = p_order_id)
    order by d.created_at asc
    limit normalized_limit
    for update skip locked
  )
  update public.admin_push_dispatches as d
  set
    status = 'processing',
    attempt_count = d.attempt_count + 1,
    last_attempt_at = now(),
    completed_at = null,
    last_error = null,
    updated_at = now()
  from candidates
  where d.id = candidates.id
  returning d.*;
end;
$$;

revoke all on function public.claim_admin_push_dispatches(integer, bigint) from public;
revoke all on function public.claim_admin_push_dispatches(integer, bigint) from anon;
revoke all on function public.claim_admin_push_dispatches(integer, bigint) from authenticated;
grant execute on function public.claim_admin_push_dispatches(integer, bigint) to service_role;

commit;
