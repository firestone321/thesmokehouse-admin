-- Phase 29: Pending Payment Recovery Safety
-- Purpose:
-- - Keep pending checkout cleanup event-driven so it works on Vercel Hobby without cron.
-- - Allow a provider-confirmed paid order to re-enter the paid admin workflow even if the
--   local pending timeout had already soft-cancelled it.

create or replace function public.mark_order_as_paid(
  p_order_id bigint,
  p_payment_provider text default 'pesapal',
  p_order_tracking_id text default null,
  p_payment_reference text default null,
  p_payment_redirect_url text default null,
  p_note text default null
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_previous_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reservation_error text;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.payment_status = 'paid' then
    if v_order.status = 'cancelled' then
      v_previous_status := v_order.status;

      update public.orders
      set
        status = 'confirmed',
        cancelled_at = null,
        fulfillment_review_required = false,
        fulfillment_review_reason = null
      where id = p_order_id
      returning *
      into v_order;

      insert into public.order_status_events (
        order_id,
        event_type,
        from_status,
        to_status,
        note
      )
      values (
        p_order_id,
        'status_changed',
        v_previous_status,
        'confirmed',
        coalesce(v_note, 'Payment verified after pending checkout timeout; order restored to paid workflow.')
      );
    end if;

    if v_order.stock_reserved_at is null then
      begin
        perform public.reserve_paid_order_stock(p_order_id);
      exception
        when others then
          v_reservation_error := sqlerrm;

          update public.orders
          set
            stock_reservation_status = 'failed',
            stock_reservation_error = v_reservation_error,
            stock_reservation_attempted_at = now(),
            fulfillment_review_required = true,
            fulfillment_review_reason = 'Payment succeeded, but stock could not be reserved automatically. Review this order before fulfillment.'
          where id = p_order_id;

          insert into public.order_status_events (
            order_id,
            event_type,
            from_status,
            to_status,
            note
          )
          values (
            p_order_id,
            'note_added',
            null,
            null,
            'Stock reservation failed after paid verification: ' || v_reservation_error
          );
      end;

      select *
      into v_order
      from public.orders
      where id = p_order_id;
    end if;

    return v_order;
  end if;

  v_previous_status := v_order.status;

  update public.orders
  set
    payment_status = 'paid',
    payment_provider = coalesce(nullif(btrim(coalesce(p_payment_provider, '')), ''), payment_provider, 'pesapal'),
    order_tracking_id = coalesce(nullif(btrim(coalesce(p_order_tracking_id, '')), ''), order_tracking_id),
    payment_reference = coalesce(nullif(btrim(coalesce(p_payment_reference, '')), ''), payment_reference),
    payment_redirect_url = coalesce(nullif(btrim(coalesce(p_payment_redirect_url, '')), ''), payment_redirect_url),
    payment_last_verified_at = now(),
    paid_at = coalesce(paid_at, now()),
    payment_initiation_failure_code = null,
    payment_initiation_failure_message = null,
    payment_initiation_failed_at = null,
    stock_reservation_status = case when stock_reserved_at is not null then stock_reservation_status else 'not_started' end,
    stock_reservation_error = null,
    fulfillment_review_required = false,
    fulfillment_review_reason = null,
    cancelled_at = case when status = 'cancelled' then null else cancelled_at end,
    status = case when status in ('new', 'cancelled') then 'confirmed' else status end
  where id = p_order_id
  returning *
  into v_order;

  begin
    perform public.reserve_paid_order_stock(p_order_id);
  exception
    when others then
      v_reservation_error := sqlerrm;

      update public.orders
      set
        stock_reservation_status = 'failed',
        stock_reservation_error = v_reservation_error,
        stock_reservation_attempted_at = now(),
        fulfillment_review_required = true,
        fulfillment_review_reason = 'Payment succeeded, but stock could not be reserved automatically. Review this order before fulfillment.'
      where id = p_order_id;

      insert into public.order_status_events (
        order_id,
        event_type,
        from_status,
        to_status,
        note
      )
      values (
        p_order_id,
        'note_added',
        null,
        null,
        'Stock reservation failed after paid verification: ' || v_reservation_error
      );
  end;

  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if v_previous_status <> v_order.status then
    insert into public.order_status_events (
      order_id,
      event_type,
      from_status,
      to_status,
      note
    )
    values (
      v_order.id,
      'status_changed',
      v_previous_status,
      v_order.status,
      coalesce(v_note, 'Payment verified and stock reservation attempted.')
    );
  elsif v_note is not null then
    insert into public.order_status_events (
      order_id,
      event_type,
      from_status,
      to_status,
      note
    )
    values (
      v_order.id,
      'note_added',
      null,
      null,
      v_note
    );
  end if;

  return v_order;
end;
$$;
