begin;

-- Phase 31: shared public API rate-limit buckets.
-- Purpose:
-- 1. Replace server-memory counters with a Supabase-backed limiter that works across serverless instances.
-- 2. Keep rate-limit bucket storage private to the service role.
-- 3. Reuse one small RPC from storefront order, payment, and push endpoints.

create table if not exists public.api_rate_limits (
  key text primary key,
  hits integer not null check (hits >= 0),
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists api_rate_limits_expires_at_idx
  on public.api_rate_limits (expires_at);

alter table public.api_rate_limits enable row level security;

create or replace function public.consume_rate_limit(
  rate_key text,
  max_requests integer,
  window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_now timestamptz := now();
  current_row public.api_rate_limits%rowtype;
begin
  if max_requests <= 0 or window_seconds <= 0 then
    raise exception 'Invalid rate limit configuration.';
  end if;

  insert into public.api_rate_limits as bucket (
    key,
    hits,
    window_started_at,
    expires_at,
    updated_at
  )
  values (
    rate_key,
    1,
    current_now,
    current_now + make_interval(secs => window_seconds),
    current_now
  )
  on conflict (key) do update
  set
    hits = case
      when bucket.expires_at <= current_now then 1
      else bucket.hits + 1
    end,
    window_started_at = case
      when bucket.expires_at <= current_now then current_now
      else bucket.window_started_at
    end,
    expires_at = case
      when bucket.expires_at <= current_now then current_now + make_interval(secs => window_seconds)
      else bucket.expires_at
    end,
    updated_at = current_now
  returning * into current_row;

  return query
  select
    current_row.hits <= max_requests,
    greatest(0, max_requests - least(current_row.hits, max_requests)),
    greatest(1, ceil(extract(epoch from current_row.expires_at - current_now))::integer);

  delete from public.api_rate_limits
  where expires_at < current_now - interval '1 day';
end;
$$;

revoke all on table public.api_rate_limits from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_rate_limit(text, integer, integer) from anon;
revoke all on function public.consume_rate_limit(text, integer, integer) from authenticated;
grant all on table public.api_rate_limits to service_role;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

commit;
