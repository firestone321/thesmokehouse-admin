begin;

-- Phase 51: serialize admin paid-order push drains across instances.
-- Each new admin subscription kicks off a drain. Without a mutex, concurrent
-- subscribers race and we send duplicate pushes or interleave reopen/process
-- steps (PS-PERF-08). A TTL-bounded singleton row in the DB acts as the
-- mutex; if a holder dies mid-drain the lock auto-expires.

create table if not exists public.admin_push_drain_lock (
  id integer primary key default 1,
  holder text not null,
  expires_at timestamptz not null,
  constraint admin_push_drain_lock_singleton check (id = 1)
);

alter table public.admin_push_drain_lock enable row level security;

create or replace function public.try_acquire_admin_push_drain_lock(
  p_holder text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_count integer;
begin
  insert into public.admin_push_drain_lock (id, holder, expires_at)
  values (1, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (id) do update
  set holder = excluded.holder,
      expires_at = excluded.expires_at
  where public.admin_push_drain_lock.expires_at < now();

  get diagnostics v_inserted_count = ROW_COUNT;
  return v_inserted_count > 0;
end;
$$;

revoke execute on function public.try_acquire_admin_push_drain_lock(text, integer) from public, anon, authenticated;
grant execute on function public.try_acquire_admin_push_drain_lock(text, integer) to service_role;

create or replace function public.release_admin_push_drain_lock(p_holder text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.admin_push_drain_lock
  where id = 1 and holder = p_holder;
$$;

revoke execute on function public.release_admin_push_drain_lock(text) from public, anon, authenticated;
grant execute on function public.release_admin_push_drain_lock(text) to service_role;

commit;
