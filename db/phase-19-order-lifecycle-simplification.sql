begin;

-- Phase 19: simplify the live order lifecycle and remove the smoker-only click.
-- Purpose:
-- 1. Collapse the manual status chain to:
--    new -> confirmed -> in_prep -> ready -> completed
-- 2. Preserve existing live data by remapping any legacy on_smoker rows to in_prep.
-- 3. Rebuild constraints and transition logic around the simplified flow.

update public.orders
set status = 'in_prep'
where status = 'on_smoker';

update public.order_status_events
set from_status = 'in_prep'
where from_status = 'on_smoker';

update public.order_status_events
set to_status = 'in_prep'
where to_status = 'on_smoker';

alter table public.orders
  drop constraint if exists orders_status_chk;

alter table public.orders
  add constraint orders_status_chk
  check (status in ('new', 'confirmed', 'in_prep', 'ready', 'completed', 'cancelled'));

alter table public.order_status_events
  drop constraint if exists order_status_events_from_status_chk;

alter table public.order_status_events
  add constraint order_status_events_from_status_chk
  check (
    from_status is null or from_status in ('new', 'confirmed', 'in_prep', 'ready', 'completed', 'cancelled')
  );

alter table public.order_status_events
  drop constraint if exists order_status_events_to_status_chk;

alter table public.order_status_events
  add constraint order_status_events_to_status_chk
  check (
    to_status is null or to_status in ('new', 'confirmed', 'in_prep', 'ready', 'completed', 'cancelled')
  );

create or replace function public.transition_order_status(
  p_order_id bigint,
  p_to_status text,
  p_note text default null
)
returns public.orders
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_from_status text;
  v_valid boolean := false;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  v_from_status := v_order.status;

  v_valid := case
    when v_from_status = 'new' and p_to_status in ('confirmed', 'cancelled') then true
    when v_from_status = 'confirmed' and p_to_status in ('in_prep', 'cancelled') then true
    when v_from_status = 'in_prep' and p_to_status in ('ready', 'cancelled') then true
    when v_from_status = 'ready' and p_to_status in ('completed', 'cancelled') then true
    else false
  end;

  if not v_valid then
    raise exception 'Invalid order status transition from % to %', v_from_status, p_to_status;
  end if;

  update public.orders
  set
    status = p_to_status,
    completed_at = case when p_to_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
    cancelled_at = case when p_to_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
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
    v_order.id,
    'status_changed',
    v_from_status,
    p_to_status,
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return v_order;
end;
$$;

commit;
