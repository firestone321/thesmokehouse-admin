begin;

-- Review-only migration source. Do not apply until the payment patch and tests
-- have been reviewed together.

create or replace function public.prevent_paid_payment_downgrade()
returns trigger
language plpgsql
as $$
begin
  if lower(coalesce(old.payment_status, '')) = 'paid'
    and lower(coalesce(new.payment_status, '')) <> 'paid' then
    raise exception 'paid_payment_status_cannot_be_downgraded';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_prevent_paid_payment_downgrade on public.orders;
create trigger orders_prevent_paid_payment_downgrade
before update of payment_status on public.orders
for each row
execute function public.prevent_paid_payment_downgrade();

drop trigger if exists payment_attempts_prevent_paid_payment_downgrade on public.payment_attempts;
create trigger payment_attempts_prevent_paid_payment_downgrade
before update of payment_status on public.payment_attempts
for each row
execute function public.prevent_paid_payment_downgrade();

create or replace function public.apply_pesapal_payment_verification(
  p_order_id bigint,
  p_payment_attempt_id bigint,
  p_supplied_tracking_id text,
  p_provider_tracking_id text,
  p_merchant_reference text,
  p_provider_amount numeric,
  p_provider_currency text,
  p_provider_status text,
  p_payment_reference text,
  p_raw_response jsonb,
  p_cancellation_confirmed boolean default false
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_status text := upper(btrim(coalesce(p_provider_status, '')));
  v_tracking_id text := nullif(btrim(coalesce(p_supplied_tracking_id, '')), '');
  v_provider_tracking_id text := nullif(btrim(coalesce(p_provider_tracking_id, '')), '');
  v_merchant_reference text := nullif(btrim(coalesce(p_merchant_reference, '')), '');
  v_currency text := upper(btrim(coalesce(p_provider_currency, '')));
begin
  select o.*
  into v_order
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  select pa.*
  into v_attempt
  from public.payment_attempts as pa
  where pa.id = p_payment_attempt_id
    and pa.order_id = v_order.id
    and pa.provider = 'pesapal'
  for update;

  if not found then
    raise exception 'payment_attempt_not_found';
  end if;

  if v_order.active_payment_attempt_id is distinct from v_attempt.id then
    raise exception 'payment_attempt_is_not_active';
  end if;

  if v_tracking_id is null
    or v_order.order_tracking_id is distinct from v_tracking_id
    or v_attempt.provider_reference is distinct from v_tracking_id then
    raise exception 'supplied_tracking_id_binding_mismatch';
  end if;

  if v_provider_tracking_id is null
    or v_provider_tracking_id is distinct from v_tracking_id then
    raise exception 'provider_tracking_id_binding_mismatch';
  end if;

  if v_status = 'COMPLETED' then
    if v_merchant_reference is null
      or v_merchant_reference is distinct from v_order.public_token then
      raise exception 'merchant_reference_binding_mismatch';
    end if;

    if p_provider_amount is null
      or p_provider_amount <> v_order.total_amount::numeric then
      raise exception 'provider_amount_binding_mismatch';
    end if;

    if v_currency <> 'UGX' then
      raise exception 'provider_currency_binding_mismatch';
    end if;

    v_order := public.mark_order_as_paid(
      v_order.id,
      'pesapal',
      v_tracking_id,
      p_payment_reference,
      v_order.payment_redirect_url,
      'Payment verified through bound Pesapal transaction status.'
    );

    update public.payment_attempts
    set
      lifecycle_status = 'initiated',
      payment_status = 'paid',
      provider_status = v_status,
      payment_reference = nullif(btrim(coalesce(p_payment_reference, '')), ''),
      raw_response = coalesce(p_raw_response, '{}'::jsonb),
      verified_at = coalesce(verified_at, now())
    where id = v_attempt.id;

    return v_order;
  end if;

  -- Paid is terminal. A stale Pending, Failed, Invalid or Cancelled observation
  -- cannot overwrite it, regardless of callback/IPN arrival order.
  if lower(coalesce(v_order.payment_status, '')) = 'paid'
    or lower(coalesce(v_attempt.payment_status, '')) = 'paid' then
    return v_order;
  end if;

  if v_status = 'CANCELLED' then
    if not p_cancellation_confirmed then
      raise exception 'provider_cancellation_confirmation_required';
    end if;

    update public.payment_attempts
    set
      lifecycle_status = 'failed',
      payment_status = 'cancelled',
      provider_status = v_status,
      provider_message = 'Pesapal cancellation confirmed by the server.',
      raw_response = coalesce(p_raw_response, '{}'::jsonb),
      verified_at = now()
    where id = v_attempt.id
      and payment_status <> 'paid';

    update public.orders
    set
      status = case when status = 'new' then 'cancelled' else status end,
      payment_status = 'cancelled',
      payment_provider = 'pesapal',
      payment_last_verified_at = now(),
      cancelled_at = case when status = 'new' then coalesce(cancelled_at, now()) else cancelled_at end
    where id = v_order.id
      and payment_status <> 'paid'
    returning *
    into v_order;

    return v_order;
  end if;

  if v_status in ('FAILED', 'REVERSED') then
    update public.payment_attempts
    set
      lifecycle_status = 'failed',
      payment_status = 'failed',
      provider_status = v_status,
      payment_reference = nullif(btrim(coalesce(p_payment_reference, '')), ''),
      raw_response = coalesce(p_raw_response, '{}'::jsonb),
      verified_at = now()
    where id = v_attempt.id
      and payment_status not in ('paid', 'cancelled');

    update public.orders
    set
      payment_status = 'failed',
      payment_provider = 'pesapal',
      payment_reference = coalesce(
        nullif(btrim(coalesce(p_payment_reference, '')), ''),
        payment_reference
      ),
      payment_last_verified_at = now()
    where id = v_order.id
      and payment_status not in ('paid', 'cancelled')
    returning *
    into v_order;

    return v_order;
  end if;

  -- Pending/Invalid status only refreshes verification metadata. It cannot
  -- revive a terminal attempt or order.
  update public.payment_attempts
  set
    provider_status = v_status,
    payment_reference = coalesce(
      nullif(btrim(coalesce(p_payment_reference, '')), ''),
      payment_reference
    ),
    raw_response = coalesce(p_raw_response, '{}'::jsonb),
    verified_at = now()
  where id = v_attempt.id
    and payment_status = 'pending';

  update public.orders
  set
    payment_provider = 'pesapal',
    payment_last_verified_at = now()
  where id = v_order.id
    and payment_status = 'pending'
  returning *
  into v_order;

  return v_order;
end;
$$;

revoke all
  on function public.apply_pesapal_payment_verification(bigint, bigint, text, text, text, numeric, text, text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute
  on function public.apply_pesapal_payment_verification(bigint, bigint, text, text, text, numeric, text, text, text, jsonb, boolean)
  to service_role;

create or replace function public.reject_storefront_payment_initiation(
  p_public_token text,
  p_payment_attempt_id bigint,
  p_reason_code text,
  p_reason_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
begin
  select o.*
  into v_order
  from public.orders as o
  where o.public_token = p_public_token
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  if v_order.active_payment_attempt_id is distinct from p_payment_attempt_id then
    raise exception 'payment_attempt_is_not_active';
  end if;

  select pa.*
  into v_attempt
  from public.payment_attempts as pa
  where pa.id = p_payment_attempt_id
    and pa.order_id = v_order.id
    and pa.provider = 'pesapal'
  for update;

  if not found then
    raise exception 'payment_attempt_not_found';
  end if;

  if v_order.payment_status <> 'pending'
    or v_order.status <> 'new'
    or v_order.order_tracking_id is not null
    or v_order.payment_redirect_url is not null
    or v_order.stock_reserved_at is not null
    or v_attempt.provider_reference is not null then
    return false;
  end if;

  update public.payment_attempts
  set
    lifecycle_status = 'rejected',
    payment_status = 'cancelled',
    provider_message = p_reason_message,
    verified_at = now()
  where id = v_attempt.id;

  update public.orders
  set
    status = 'cancelled',
    payment_status = 'cancelled',
    payment_provider = 'pesapal',
    payment_initiation_failure_code = nullif(btrim(coalesce(p_reason_code, '')), ''),
    payment_initiation_failure_message = nullif(btrim(coalesce(p_reason_message, '')), ''),
    payment_initiation_failed_at = now(),
    cancelled_at = coalesce(cancelled_at, now())
  where id = v_order.id;

  return true;
end;
$$;

revoke all
  on function public.reject_storefront_payment_initiation(text, bigint, text, text)
  from public, anon, authenticated;
grant execute
  on function public.reject_storefront_payment_initiation(text, bigint, text, text)
  to service_role;

comment on function public.apply_pesapal_payment_verification(bigint, bigint, text, text, text, numeric, text, text, text, jsonb, boolean) is
  'Row-locks the order and active attempt, validates the complete Pesapal binding, and applies a monotonic payment transition.';

comment on function public.reject_storefront_payment_initiation(text, bigint, text, text) is
  'Atomically rejects only an untracked active payment attempt and cannot race a tracked or paid transition.';

commit;
