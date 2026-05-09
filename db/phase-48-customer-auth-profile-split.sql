begin;

-- Phase 48: keep storefront customer signups out of admin/staff profiles.
-- Public OAuth/email signups become customers. Admin-provisioned users become profiles.

create table if not exists public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_email_not_blank_chk check (btrim(email) <> '')
);

create index if not exists customers_email_idx
  on public.customers (email);

comment on table public.customers is
  'Storefront customer account directory for public OAuth/email signups.';

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row
execute function public.set_updated_at();

alter table public.customers enable row level security;

alter table public.profiles
  alter column role drop default;

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
  if requested_role in ('admin', 'manager', 'staff') then
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

drop policy if exists "customers_select_self_or_admin_manager" on public.customers;
create policy "customers_select_self_or_admin_manager"
on public.customers
for select
to authenticated
using (
  id = auth.uid()
  or public.has_role(array['admin'::public.app_role, 'manager'::public.app_role])
);

drop policy if exists "customers_insert_self_or_admin_manager" on public.customers;
create policy "customers_insert_self_or_admin_manager"
on public.customers
for insert
to authenticated
with check (
  id = auth.uid()
  or public.has_role(array['admin'::public.app_role, 'manager'::public.app_role])
);

drop policy if exists "customers_update_self_or_admin_manager" on public.customers;
create policy "customers_update_self_or_admin_manager"
on public.customers
for update
to authenticated
using (
  id = auth.uid()
  or public.has_role(array['admin'::public.app_role, 'manager'::public.app_role])
)
with check (
  id = auth.uid()
  or public.has_role(array['admin'::public.app_role, 'manager'::public.app_role])
);

commit;
