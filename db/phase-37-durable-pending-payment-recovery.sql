begin;

-- Phase 37: Durable pending-payment recovery without cron.
-- Purpose:
-- - Keep Pesapal-tracked pending payments recoverable from Supabase state.
-- - Let callback, IPN, status polling, order tracking, and admin/manual actions
--   race safely across Vercel serverless instances.
-- - Preserve paid-sticky semantics: the queue only drives verification; provider
--   paid truth is still persisted by mark_order_as_paid(...).

create table if not exists public.pending_payment_recoveries (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on update cascade on delete cascade,
  provider text not null default 'pesapal',
  order_tracking_id text not null,
  status text not null default 'pending',
  next_attempt_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 500,
  locked_at timestamptz,
  locked_by text,
  last_verified_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_payment_recoveries_status_chk
    check (status in ('pending', 'processing', 'retrying', 'completed', 'failed')),
  constraint pending_payment_recoveries_attempt_count_chk
    check (attempt_count >= 0),
  constraint pending_payment_recoveries_max_attempts_chk
    check (max_attempts > 0)
);

create unique index if not exists pending_payment_recoveries_provider_tracking_uidx
  on public.pending_payment_recoveries(provider, order_tracking_id);

create index if not exists pending_payment_recoveries_due_idx
  on public.pending_payment_recoveries(status, next_attempt_at, created_at)
  where status in ('pending', 'retrying', 'processing');

create index if not exists pending_payment_recoveries_order_idx
  on public.pending_payment_recoveries(order_id, created_at desc);

alter table public.pending_payment_recoveries enable row level security;

drop trigger if exists pending_payment_recoveries_set_updated_at on public.pending_payment_recoveries;
create trigger pending_payment_recoveries_set_updated_at
before update on public.pending_payment_recoveries
for each row
execute function public.set_updated_at();

create or replace function public.enqueue_pending_payment_recovery(
  p_order_id bigint,
  p_order_tracking_id text,
  p_provider text default 'pesapal',
  p_reason text default null
)
returns public.pending_payment_recoveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text := coalesce(nullif(btrim(coalesce(p_provider, '')), ''), 'pesapal');
  v_tracking text := nullif(btrim(coalesce(p_order_tracking_id, '')), '');
  v_recovery public.pending_payment_recoveries%rowtype;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;

  if v_tracking is null then
    raise exception 'order_tracking_id is required';
  end if;

  insert into public.pending_payment_recoveries (
    order_id,
    provider,
    order_tracking_id,
    status,
    next_attempt_at,
    last_error
  )
  values (
    p_order_id,
    v_provider,
    v_tracking,
    'pending',
    now(),
    nullif(btrim(coalesce(p_reason, '')), '')
  )
  on conflict (provider, order_tracking_id)
  do update
  set
    order_id = excluded.order_id,
    status = case
      when pending_payment_recoveries.status = 'completed' then pending_payment_recoveries.status
      when pending_payment_recoveries.status = 'processing' then 'retrying'
      when pending_payment_recoveries.status = 'failed'
        and pending_payment_recoveries.attempt_count < pending_payment_recoveries.max_attempts then 'retrying'
      else pending_payment_recoveries.status
    end,
    next_attempt_at = case
      when pending_payment_recoveries.status = 'completed' then pending_payment_recoveries.next_attempt_at
      else least(pending_payment_recoveries.next_attempt_at, now())
    end,
    completed_at = case
      when pending_payment_recoveries.status = 'completed' then pending_payment_recoveries.completed_at
      else null
    end,
    last_error = case
      when pending_payment_recoveries.status = 'completed' then pending_payment_recoveries.last_error
      else coalesce(nullif(btrim(coalesce(p_reason, '')), ''), pending_payment_recoveries.last_error)
    end,
    updated_at = now()
  returning *
  into v_recovery;

  return v_recovery;
end;
$$;

create or replace function public.claim_pending_payment_recoveries(
  p_limit integer default 5,
  p_worker_id text default null,
  p_order_id bigint default null
)
returns setof public.pending_payment_recoveries
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_limit integer := greatest(1, least(coalesce(p_limit, 5), 25));
  normalized_worker text := coalesce(nullif(btrim(coalesce(p_worker_id, '')), ''), 'unknown');
begin
  return query
  with candidates as (
    select r.id
    from public.pending_payment_recoveries r
    where (
      (
        r.status in ('pending', 'retrying')
        and r.next_attempt_at <= now()
        and r.attempt_count < r.max_attempts
      )
      or (
        r.status = 'processing'
        and r.locked_at is not null
        and r.locked_at <= now() - interval '5 minutes'
        and r.attempt_count < r.max_attempts
      )
    )
    and (p_order_id is null or r.order_id = p_order_id)
    order by r.next_attempt_at asc, r.created_at asc
    limit normalized_limit
    for update skip locked
  )
  update public.pending_payment_recoveries as r
  set
    status = 'processing',
    attempt_count = r.attempt_count + 1,
    locked_at = now(),
    locked_by = normalized_worker,
    last_error = null,
    updated_at = now()
  from candidates
  where r.id = candidates.id
  returning r.*;
end;
$$;

revoke all on function public.enqueue_pending_payment_recovery(bigint, text, text, text) from public;
revoke all on function public.enqueue_pending_payment_recovery(bigint, text, text, text) from anon;
revoke all on function public.enqueue_pending_payment_recovery(bigint, text, text, text) from authenticated;
grant execute on function public.enqueue_pending_payment_recovery(bigint, text, text, text) to service_role;

revoke all on function public.claim_pending_payment_recoveries(integer, text, bigint) from public;
revoke all on function public.claim_pending_payment_recoveries(integer, text, bigint) from anon;
revoke all on function public.claim_pending_payment_recoveries(integer, text, bigint) from authenticated;
grant execute on function public.claim_pending_payment_recoveries(integer, text, bigint) to service_role;

commit;
