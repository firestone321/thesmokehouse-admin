begin;

-- Phase 41: Push queue snapshot RPCs.
-- Replaces 20 parallel count + preview queries in getPushQueueSnapshots()
-- with 2 single-round-trip RPC calls — one per queue.

create or replace function public.get_admin_push_queue_snapshot(
  p_now          timestamptz,
  p_stale_before timestamptz
)
returns table (
  subscription_count     bigint,
  open_count             bigint,
  due_now_count          bigint,
  stalled_count          bigint,
  retrying_count         bigint,
  failed_count           bigint,
  no_subscribers_count   bigint,
  oldest_open_created_at timestamptz,
  next_open_attempt_at   timestamptz,
  recent_dispatches      jsonb
)
language sql stable as $$
  select
    (select count(*)::bigint from public.admin_push_subscriptions),
    (select count(*)::bigint from public.admin_push_dispatches
       where status in ('pending', 'processing', 'no_subscribers')),
    (select count(*)::bigint from public.admin_push_dispatches
       where status in ('pending', 'no_subscribers') and next_attempt_at <= p_now),
    (select count(*)::bigint from public.admin_push_dispatches
       where status = 'processing' and last_attempt_at <= p_stale_before),
    (select count(*)::bigint from public.admin_push_dispatches
       where status = 'pending' and attempt_count > 0),
    (select count(*)::bigint from public.admin_push_dispatches
       where status = 'failed'),
    (select count(*)::bigint from public.admin_push_dispatches
       where status = 'no_subscribers'),
    (select min(created_at) from public.admin_push_dispatches
       where status in ('pending', 'processing', 'no_subscribers')),
    (select min(next_attempt_at) from public.admin_push_dispatches
       where status in ('pending', 'processing', 'no_subscribers')),
    coalesce(
      (select jsonb_agg(t) from (
         select id, order_id, status, attempt_count, created_at,
                next_attempt_at, last_attempt_at, completed_at, last_error
         from public.admin_push_dispatches
         where status in ('pending', 'processing', 'failed', 'no_subscribers')
         order by created_at desc
         limit 5
       ) t),
      '[]'::jsonb
    )
$$;

revoke execute on function public.get_admin_push_queue_snapshot(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_admin_push_queue_snapshot(timestamptz, timestamptz)
  to service_role;

create or replace function public.get_storefront_push_queue_snapshot(
  p_now          timestamptz,
  p_stale_before timestamptz
)
returns table (
  subscription_count     bigint,
  open_count             bigint,
  due_now_count          bigint,
  stalled_count          bigint,
  retrying_count         bigint,
  failed_count           bigint,
  oldest_open_created_at timestamptz,
  next_open_attempt_at   timestamptz,
  recent_dispatches      jsonb
)
language sql stable as $$
  select
    (select count(*)::bigint from public.push_subscriptions),
    (select count(*)::bigint from public.push_notification_dispatches
       where completed_at is null),
    (select count(*)::bigint from public.push_notification_dispatches
       where completed_at is null and next_attempt_at <= p_now),
    (select count(*)::bigint from public.push_notification_dispatches
       where completed_at is null
         and processing_started_at is not null
         and processing_started_at <= p_stale_before),
    (select count(*)::bigint from public.push_notification_dispatches
       where completed_at is null and attempt_count > 0),
    (select count(*)::bigint from public.push_notification_dispatches
       where completed_at is not null and last_error is not null),
    (select min(created_at) from public.push_notification_dispatches
       where completed_at is null),
    (select min(next_attempt_at) from public.push_notification_dispatches
       where completed_at is null),
    coalesce(
      (select jsonb_agg(t) from (
         select idempotency_key, order_id, attempt_count, created_at,
                next_attempt_at, last_attempt_at, processing_started_at,
                completed_at, last_error
         from public.push_notification_dispatches
         where completed_at is null or last_error is not null
         order by created_at desc
         limit 5
       ) t),
      '[]'::jsonb
    )
$$;

revoke execute on function public.get_storefront_push_queue_snapshot(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_storefront_push_queue_snapshot(timestamptz, timestamptz)
  to service_role;

comment on function public.get_admin_push_queue_snapshot(timestamptz, timestamptz) is
  'Returns admin push queue health in one round trip: all counts, oldest/next timestamps, and last 5 dispatch previews.';
comment on function public.get_storefront_push_queue_snapshot(timestamptz, timestamptz) is
  'Returns customer ready-push queue health in one round trip: all counts, oldest/next timestamps, and last 5 dispatch previews.';

commit;
