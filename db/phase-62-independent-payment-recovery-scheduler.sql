begin;

-- Review-only scheduler source. Before applying, create these Vault secrets:
--   smokehouse_payment_recovery_url
--     e.g. https://<canonical-storefront>/api/internal/payments/recovery/cron
--   smokehouse_payment_recovery_cron_secret
--     must equal storefront PAYMENT_RECOVERY_CRON_SECRET
--
-- This schedule runs from Supabase, independently of storefront/admin traffic.
-- It wakes every five minutes but calls the storefront only while recoverable
-- payment work is due. Completed/failed queues therefore generate no HTTP load.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_existing_job_id bigint;
  v_recovery_url text;
  v_recovery_secret text;
begin
  select decrypted_secret
  into v_recovery_url
  from vault.decrypted_secrets
  where name = 'smokehouse_payment_recovery_url'
  limit 1;

  select decrypted_secret
  into v_recovery_secret
  from vault.decrypted_secrets
  where name = 'smokehouse_payment_recovery_cron_secret'
  limit 1;

  if v_recovery_url is null
    or v_recovery_url !~ '^https://[^/]+/api/internal/payments/recovery/cron$' then
    raise exception 'smokehouse_payment_recovery_url Vault secret is missing or invalid';
  end if;

  if v_recovery_secret is null or length(v_recovery_secret) < 32 then
    raise exception 'smokehouse_payment_recovery_cron_secret Vault secret must contain at least 32 characters';
  end if;

  select jobid
  into v_existing_job_id
  from cron.job
  where jobname = 'smokehouse-pending-payment-recovery'
  order by jobid desc
  limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;
end;
$$;

select cron.schedule(
  'smokehouse-pending-payment-recovery',
  '*/5 * * * *',
  $schedule$
  with prune_old_run_history as (
    delete from cron.job_run_details
    where end_time < now() - interval '7 days'
    returning runid
  )
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'smokehouse_payment_recovery_url'
      limit 1
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'smokehouse_payment_recovery_cron_secret'
        limit 1
      )
    ),
    body := jsonb_build_object(
      'scheduled_at', now()
    ),
    timeout_milliseconds := 60000
  )
  where exists (
    select 1
    from public.pending_payment_recoveries as recovery
    where (
      (
        recovery.status in ('pending', 'retrying')
        and recovery.next_attempt_at <= now()
      )
      or (
        recovery.status = 'processing'
        and recovery.locked_at is not null
        and recovery.locked_at <= now() - interval '5 minutes'
      )
    )
    and recovery.attempt_count < recovery.max_attempts
  );
  $schedule$
);

commit;
