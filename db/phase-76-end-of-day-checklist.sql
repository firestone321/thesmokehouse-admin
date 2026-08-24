-- Phase 76: shared end-of-day operations checklist and issue notes.
-- The first valid submission for a service date wins atomically. All other
-- staff members receive the same completed record and do not repeat the check.

begin;

create table if not exists public.end_of_day_checklists (
  service_date date primary key,
  responses jsonb not null,
  submitted_by_profile_id uuid not null references public.profiles(id) on update cascade on delete restrict,
  submitted_by_email_snapshot text not null,
  submitted_by_role_snapshot public.app_role not null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint end_of_day_checklists_responses_object_chk check (jsonb_typeof(responses) = 'object'),
  constraint end_of_day_checklists_email_not_blank_chk check (btrim(submitted_by_email_snapshot) <> '')
);

create index if not exists end_of_day_checklists_submitted_idx
  on public.end_of_day_checklists (submitted_at desc, service_date desc);

comment on table public.end_of_day_checklists is
  'One immutable end-of-day checklist completion per Smokehouse service day. The first valid staff submission becomes the shared record for all dashboard users.';

comment on column public.end_of_day_checklists.responses is
  'JSON object keyed by end-of-day checklist item ID. Each value has status ok/issue and an issue note when status is issue.';

alter table public.end_of_day_checklists enable row level security;
revoke all on public.end_of_day_checklists from public, anon, authenticated;
grant select on public.end_of_day_checklists to authenticated;
grant all on public.end_of_day_checklists to service_role;

drop policy if exists "end_of_day_checklists_admin_manager_read" on public.end_of_day_checklists;
create policy "end_of_day_checklists_admin_manager_read"
on public.end_of_day_checklists
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role]));

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
    and (now() at time zone 'Africa/Kampala')::time < time '20:30' then
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

commit;
