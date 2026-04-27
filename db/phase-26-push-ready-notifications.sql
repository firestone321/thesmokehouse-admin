begin;

-- Phase 26: durable customer push notifications for Ready orders.
-- Purpose:
-- 1. Store browser push subscriptions linked to customer orders.
-- 2. Queue Ready notifications durably so admin status updates are not coupled to push delivery.
-- 3. Let the storefront processor claim queued work safely with retry metadata.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  platform text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscription_orders (
  subscription_id uuid not null references public.push_subscriptions(id) on update cascade on delete cascade,
  order_id bigint not null references public.orders(id) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subscription_id, order_id)
);

create table if not exists public.push_notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  notification_type text not null,
  order_id bigint not null references public.orders(id) on update cascade on delete cascade,
  order_updated_at timestamptz not null,
  source text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  subscription_count integer not null default 0,
  success_count integer not null default 0,
  stale_subscription_count integer not null default 0,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  processing_started_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  constraint push_notification_dispatches_type_chk check (notification_type in ('order_ready')),
  constraint push_notification_dispatches_counts_chk check (
    subscription_count >= 0
    and success_count >= 0
    and stale_subscription_count >= 0
    and attempt_count >= 0
  )
);

create index if not exists push_subscription_orders_order_id_idx
  on public.push_subscription_orders (order_id);

create index if not exists push_notification_dispatches_order_id_idx
  on public.push_notification_dispatches (order_id);

create index if not exists push_notification_dispatches_pending_idx
  on public.push_notification_dispatches (notification_type, next_attempt_at)
  where completed_at is null;

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.push_subscription_orders enable row level security;
alter table public.push_notification_dispatches enable row level security;

drop policy if exists "push_subscriptions_admin_roles_read" on public.push_subscriptions;
create policy "push_subscriptions_admin_roles_read"
on public.push_subscriptions
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role]));

drop policy if exists "push_subscription_orders_admin_roles_read" on public.push_subscription_orders;
create policy "push_subscription_orders_admin_roles_read"
on public.push_subscription_orders
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role]));

drop policy if exists "push_notification_dispatches_admin_roles_read" on public.push_notification_dispatches;
create policy "push_notification_dispatches_admin_roles_read"
on public.push_notification_dispatches
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role]));

create or replace function public.claim_push_notification_dispatch(
  dispatch_idempotency_key text,
  stale_after_seconds integer default 300
)
returns table (
  id uuid,
  idempotency_key text,
  notification_type text,
  order_id bigint,
  order_updated_at timestamptz,
  source text,
  created_at timestamptz,
  completed_at timestamptz,
  subscription_count integer,
  success_count integer,
  stale_subscription_count integer,
  attempt_count integer,
  last_attempt_at timestamptz,
  last_error text,
  processing_started_at timestamptz,
  next_attempt_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.push_notification_dispatches as dispatch
  set
    processing_started_at = now(),
    last_attempt_at = now(),
    attempt_count = dispatch.attempt_count + 1
  where dispatch.idempotency_key = dispatch_idempotency_key
    and dispatch.completed_at is null
    and dispatch.next_attempt_at <= now()
    and (
      dispatch.processing_started_at is null
      or dispatch.processing_started_at <= now() - make_interval(secs => stale_after_seconds)
    )
  returning
    dispatch.id,
    dispatch.idempotency_key,
    dispatch.notification_type,
    dispatch.order_id,
    dispatch.order_updated_at,
    dispatch.source,
    dispatch.created_at,
    dispatch.completed_at,
    dispatch.subscription_count,
    dispatch.success_count,
    dispatch.stale_subscription_count,
    dispatch.attempt_count,
    dispatch.last_attempt_at,
    dispatch.last_error,
    dispatch.processing_started_at,
    dispatch.next_attempt_at;
end;
$$;

revoke all on function public.claim_push_notification_dispatch(text, integer) from public;
revoke all on function public.claim_push_notification_dispatch(text, integer) from anon;
revoke all on function public.claim_push_notification_dispatch(text, integer) from authenticated;
grant execute on function public.claim_push_notification_dispatch(text, integer) to service_role;

commit;
