-- Phase 75: shared daily operations opening checklist and issue notes.
-- The first valid submission for a service date wins atomically. All other
-- staff members receive the same completed record and do not repeat the check.

alter type public.app_role add value if not exists 'cashier';

begin;

create table if not exists public.daily_operations_checklists (
  service_date date primary key,
  responses jsonb not null,
  submitted_by_profile_id uuid not null references public.profiles(id) on update cascade on delete restrict,
  submitted_by_email_snapshot text not null,
  submitted_by_role_snapshot public.app_role not null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint daily_operations_checklists_responses_object_chk check (jsonb_typeof(responses) = 'object'),
  constraint daily_operations_checklists_email_not_blank_chk check (btrim(submitted_by_email_snapshot) <> '')
);

create index if not exists daily_operations_checklists_submitted_idx
  on public.daily_operations_checklists (submitted_at desc, service_date desc);

comment on table public.daily_operations_checklists is
  'One immutable opening checklist completion per Smokehouse service day. The first valid staff submission becomes the shared record for all dashboard users.';

comment on column public.daily_operations_checklists.responses is
  'JSON object keyed by checklist item ID. Each value has status ok/issue and an issue note when status is issue.';

alter table public.daily_operations_checklists enable row level security;
revoke all on public.daily_operations_checklists from public, anon, authenticated;
grant select on public.daily_operations_checklists to authenticated;
grant all on public.daily_operations_checklists to service_role;

drop policy if exists "daily_operations_checklists_admin_manager_read" on public.daily_operations_checklists;
create policy "daily_operations_checklists_admin_manager_read"
on public.daily_operations_checklists
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role]));

create or replace function public.complete_daily_operations_checklist(
  p_service_date date,
  p_submitted_by_profile_id uuid,
  p_responses jsonb
)
returns setof public.daily_operations_checklists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_checklist public.daily_operations_checklists%rowtype;
begin
  if p_service_date is null or p_submitted_by_profile_id is null then
    raise exception 'daily_operations_checklist_identity_required';
  end if;

  if (now() at time zone 'Africa/Kampala')::time < time '06:00' then
    raise exception 'daily_operations_checklist_not_active';
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
    raise exception 'daily_operations_checklist_access_denied';
  end if;

  if jsonb_typeof(p_responses) <> 'object'
    or jsonb_object_length(p_responses) <> 8
    or not (
      p_responses ?& array[
        'staff_readiness',
        'premises_hygiene',
        'cold_chain',
        'food_stock_condition',
        'production_readiness',
        'smoker_readiness',
        'other_equipment',
        'sales_customer_readiness'
      ]
    ) then
    raise exception 'daily_operations_checklist_items_incomplete';
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
    raise exception 'daily_operations_checklist_response_invalid';
  end if;

  insert into public.daily_operations_checklists (
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
  from public.daily_operations_checklists
  where service_date = p_service_date;

  return next v_checklist;
end;
$$;

revoke all
  on function public.complete_daily_operations_checklist(date, uuid, jsonb)
  from public, anon, authenticated;
grant execute
  on function public.complete_daily_operations_checklist(date, uuid, jsonb)
  to service_role;

comment on function public.complete_daily_operations_checklist(date, uuid, jsonb) is
  'Atomically records the first complete daily opening checklist for a service date and returns the canonical shared record to every concurrent submitter.';

commit;
