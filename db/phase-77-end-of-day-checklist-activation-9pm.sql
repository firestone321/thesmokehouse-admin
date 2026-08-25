-- Phase 77: move end-of-day checklist activation to 9:00 PM EAT.
-- Append-only repair for the already-applied Phase 76 database function.

create or replace function public.complete_end_of_day_checklist(
  p_service_date date,
  p_submitted_by_profile_id uuid,
  p_responses jsonb
)
returns setof public.end_of_day_checklists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_checklist public.end_of_day_checklists%rowtype;
  v_current_service_date date := (now() at time zone 'Africa/Kampala')::date;
begin
  if p_service_date is null or p_submitted_by_profile_id is null then
    raise exception 'end_of_day_checklist_identity_required';
  end if;

  if p_service_date = v_current_service_date
    and (now() at time zone 'Africa/Kampala')::time < time '21:00' then
    raise exception 'end_of_day_checklist_not_active';
  elsif p_service_date <> v_current_service_date
    and p_service_date <> v_current_service_date - 1 then
    raise exception 'end_of_day_checklist_service_date_invalid';
  end if;

  select *
  into v_actor
  from public.profiles
  where id = p_submitted_by_profile_id;

  if not found or v_actor.role not in (
    'admin'::public.app_role,
    'manager'::public.app_role,
    'chef'::public.app_role,
    'staff'::public.app_role,
    'cashier'::public.app_role
  ) then
    raise exception 'end_of_day_checklist_access_denied';
  end if;

  if jsonb_typeof(p_responses) <> 'object'
    or (select count(*) from jsonb_object_keys(p_responses)) <> 10
    or not (
      p_responses ?& array[
        'orders_completed',
        'stock_reconciliation',
        'waste_recorded',
        'remaining_food_controlled',
        'cold_chain_close',
        'cleaning_sanitation',
        'fire_gas_electrical_safety',
        'equipment_condition',
        'records_deviations',
        'security_next_day_readiness'
      ]
    ) then
    raise exception 'end_of_day_checklist_items_incomplete';
  end if;

  if exists (
    select 1
    from jsonb_each(p_responses) as item(key, value)
    where jsonb_typeof(item.value) <> 'object'
      or item.value->>'status' not in ('ok', 'issue')
      or (
        item.value->>'status' = 'issue'
        and nullif(btrim(coalesce(item.value->>'note', '')), '') is null
      )
  ) then
    raise exception 'end_of_day_checklist_response_invalid';
  end if;

  insert into public.end_of_day_checklists (
    service_date,
    responses,
    submitted_by_profile_id,
    submitted_by_email_snapshot,
    submitted_by_role_snapshot
  )
  values (
    p_service_date,
    p_responses,
    v_actor.id,
    v_actor.email,
    v_actor.role
  )
  on conflict (service_date) do nothing;

  select *
  into v_checklist
  from public.end_of_day_checklists
  where service_date = p_service_date;

  return next v_checklist;
end;
$$;

revoke all
  on function public.complete_end_of_day_checklist(date, uuid, jsonb)
  from public, anon, authenticated;
grant execute
  on function public.complete_end_of_day_checklist(date, uuid, jsonb)
  to service_role;

comment on function public.complete_end_of_day_checklist(date, uuid, jsonb) is
  'Atomically records the first complete end-of-day checklist for a service date and returns the canonical shared record to every concurrent submitter.';

