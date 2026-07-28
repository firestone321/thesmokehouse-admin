-- Phase 58: add the Chef role and route In Prep order pushes to Chef devices.
-- Chef inherits every database capability granted to Staff, while Manager-only
-- and Administrator-only capabilities remain unchanged.

alter type public.app_role add value if not exists 'chef' before 'staff';

begin;

create or replace function public.has_role(p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_profile_role() = any(p_roles)
    or (
      public.current_profile_role() = 'chef'::public.app_role
      and 'staff'::public.app_role = any(p_roles)
    ),
    false
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := lower(coalesce(new.raw_app_meta_data->>'role', ''));
  provisioned_by_admin boolean := lower(coalesce(new.raw_app_meta_data->>'provisioned_by_admin', 'false')) in ('true', '1', 'yes');
  profile_role public.app_role := 'staff'::public.app_role;
  full_name_value text := nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), '');
  phone_value text := nullif(btrim(coalesce(new.raw_user_meta_data->>'phone', new.phone, '')), '');
  email_value text := coalesce(nullif(btrim(new.email), ''), new.id::text || '@placeholder.local');
begin
  if requested_role in ('admin', 'manager', 'chef', 'staff') then
    profile_role := requested_role::public.app_role;
  end if;

  if provisioned_by_admin then
    insert into public.profiles (
      id,
      email,
      role
    )
    values (
      new.id,
      email_value,
      profile_role
    )
    on conflict (id) do update
    set email = excluded.email,
        role = excluded.role;
  else
    insert into public.customers (
      id,
      email,
      full_name,
      phone
    )
    values (
      new.id,
      email_value,
      full_name_value,
      phone_value
    )
    on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.customers.full_name),
        phone = coalesce(excluded.phone, public.customers.phone),
        updated_at = now();
  end if;

  return new;
end;
$$;

alter table public.admin_push_subscriptions
  add column if not exists owner_profile_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_push_subscriptions_owner_profile_id_fkey'
      and conrelid = 'public.admin_push_subscriptions'::regclass
  ) then
    alter table public.admin_push_subscriptions
      add constraint admin_push_subscriptions_owner_profile_id_fkey
      foreign key (owner_profile_id)
      references public.profiles(id)
      on update cascade
      on delete cascade;
  end if;
end
$$;

create index if not exists admin_push_subscriptions_owner_profile_id_idx
  on public.admin_push_subscriptions (owner_profile_id)
  where owner_profile_id is not null;

comment on column public.admin_push_subscriptions.owner_profile_id is
  'Dashboard profile that currently owns this browser push endpoint. Legacy unowned rows do not receive role-targeted pushes.';

alter table public.admin_push_dispatches
  drop constraint if exists admin_push_dispatches_type_chk;

alter table public.admin_push_dispatches
  add constraint admin_push_dispatches_type_chk
  check (notification_type in ('new_paid_order', 'order_in_prep'));

create or replace function public.enqueue_admin_order_in_prep_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_order_status text := '';
  next_order_status text := lower(trim(coalesce(new.status, '')));
begin
  if tg_op = 'UPDATE' then
    previous_order_status := lower(trim(coalesce(old.status, '')));
  end if;

  if next_order_status = 'in_prep'
    and previous_order_status <> 'in_prep' then
    insert into public.admin_push_dispatches (order_id, notification_type)
    values (new.id, 'order_in_prep')
    on conflict (notification_type, order_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_enqueue_admin_order_in_prep_push on public.orders;
create trigger orders_enqueue_admin_order_in_prep_push
after insert or update of status on public.orders
for each row execute function public.enqueue_admin_order_in_prep_push_dispatch();

commit;
