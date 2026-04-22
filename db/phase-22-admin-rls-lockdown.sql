begin;

-- Phase 22: admin role foundation and RLS lockdown.
-- Purpose:
-- 1. Introduce an explicit app role model for Smokehouse admin accounts.
-- 2. Back every authenticated admin user with a profile row and role.
-- 3. Enable RLS across the admin schema so only admin-role accounts can read or mutate data directly.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
  ) then
    create type public.app_role as enum ('admin', 'manager', 'staff');
  end if;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role public.app_role not null default 'staff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_not_blank_chk check (btrim(email) <> '')
);

create index if not exists profiles_role_idx
  on public.profiles (role);

comment on table public.profiles is
  'Admin account directory for authenticated dashboard users and their database role.';

comment on column public.profiles.role is
  'App-level role used by RLS policies for admin dashboard access.';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

insert into public.profiles (
  id,
  email,
  role
)
select
  u.id,
  coalesce(nullif(btrim(u.email), ''), u.id::text || '@placeholder.local'),
  'staff'::public.app_role
from auth.users u
on conflict (id) do update
set email = excluded.email
where public.profiles.email is distinct from excluded.email;

create or replace function public.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid();
$$;

create or replace function public.has_role(p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = any(p_roles), false);
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    role
  )
  values (
    new.id,
    coalesce(nullif(btrim(new.email), ''), new.id::text || '@placeholder.local'),
    'staff'
  )
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.proteins enable row level security;
alter table public.packaging_types enable row level security;
alter table public.portion_types enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_item_components enable row level security;
alter table public.daily_stock enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.procurement_receipts enable row level security;
alter table public.finished_stock enable row level security;
alter table public.finished_stock_movements enable row level security;
alter table public.processing_batches enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_events enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.ops_incidents enable row level security;
alter table public.suppliers enable row level security;

drop policy if exists "profiles_select_self_or_admin_manager" on public.profiles;
create policy "profiles_select_self_or_admin_manager"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.has_role(array['admin'::public.app_role, 'manager'::public.app_role])
);

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.has_role(array['admin'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role]));

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete"
on public.profiles
for delete
to authenticated
using (public.has_role(array['admin'::public.app_role]));

drop policy if exists "proteins_admin_roles_read" on public.proteins;
create policy "proteins_admin_roles_read"
on public.proteins
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "proteins_admin_roles_write" on public.proteins;
create policy "proteins_admin_roles_write"
on public.proteins
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "packaging_types_admin_roles_read" on public.packaging_types;
create policy "packaging_types_admin_roles_read"
on public.packaging_types
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "packaging_types_admin_roles_write" on public.packaging_types;
create policy "packaging_types_admin_roles_write"
on public.packaging_types
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "portion_types_admin_roles_read" on public.portion_types;
create policy "portion_types_admin_roles_read"
on public.portion_types
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "portion_types_admin_roles_write" on public.portion_types;
create policy "portion_types_admin_roles_write"
on public.portion_types
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "menu_categories_admin_roles_read" on public.menu_categories;
create policy "menu_categories_admin_roles_read"
on public.menu_categories
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "menu_categories_admin_roles_write" on public.menu_categories;
create policy "menu_categories_admin_roles_write"
on public.menu_categories
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "menu_items_admin_roles_read" on public.menu_items;
create policy "menu_items_admin_roles_read"
on public.menu_items
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "menu_items_admin_roles_write" on public.menu_items;
create policy "menu_items_admin_roles_write"
on public.menu_items
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "menu_item_components_admin_roles_read" on public.menu_item_components;
create policy "menu_item_components_admin_roles_read"
on public.menu_item_components
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "menu_item_components_admin_roles_write" on public.menu_item_components;
create policy "menu_item_components_admin_roles_write"
on public.menu_item_components
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "daily_stock_admin_roles_read" on public.daily_stock;
create policy "daily_stock_admin_roles_read"
on public.daily_stock
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "daily_stock_admin_roles_write" on public.daily_stock;
create policy "daily_stock_admin_roles_write"
on public.daily_stock
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "inventory_items_admin_roles_read" on public.inventory_items;
create policy "inventory_items_admin_roles_read"
on public.inventory_items
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "inventory_items_admin_roles_write" on public.inventory_items;
create policy "inventory_items_admin_roles_write"
on public.inventory_items
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "inventory_movements_admin_roles_read" on public.inventory_movements;
create policy "inventory_movements_admin_roles_read"
on public.inventory_movements
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "inventory_movements_admin_roles_write" on public.inventory_movements;
create policy "inventory_movements_admin_roles_write"
on public.inventory_movements
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "procurement_receipts_admin_roles_read" on public.procurement_receipts;
create policy "procurement_receipts_admin_roles_read"
on public.procurement_receipts
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "procurement_receipts_admin_roles_write" on public.procurement_receipts;
create policy "procurement_receipts_admin_roles_write"
on public.procurement_receipts
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "finished_stock_admin_roles_read" on public.finished_stock;
create policy "finished_stock_admin_roles_read"
on public.finished_stock
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "finished_stock_admin_roles_write" on public.finished_stock;
create policy "finished_stock_admin_roles_write"
on public.finished_stock
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "finished_stock_movements_admin_roles_read" on public.finished_stock_movements;
create policy "finished_stock_movements_admin_roles_read"
on public.finished_stock_movements
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "finished_stock_movements_admin_roles_write" on public.finished_stock_movements;
create policy "finished_stock_movements_admin_roles_write"
on public.finished_stock_movements
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "processing_batches_admin_roles_read" on public.processing_batches;
create policy "processing_batches_admin_roles_read"
on public.processing_batches
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "processing_batches_admin_roles_write" on public.processing_batches;
create policy "processing_batches_admin_roles_write"
on public.processing_batches
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "orders_admin_roles_read" on public.orders;
create policy "orders_admin_roles_read"
on public.orders
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "orders_admin_roles_write" on public.orders;
create policy "orders_admin_roles_write"
on public.orders
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "order_items_admin_roles_read" on public.order_items;
create policy "order_items_admin_roles_read"
on public.order_items
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "order_items_admin_roles_write" on public.order_items;
create policy "order_items_admin_roles_write"
on public.order_items
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "order_status_events_admin_roles_read" on public.order_status_events;
create policy "order_status_events_admin_roles_read"
on public.order_status_events
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "order_status_events_admin_roles_write" on public.order_status_events;
create policy "order_status_events_admin_roles_write"
on public.order_status_events
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "payment_attempts_admin_roles_read" on public.payment_attempts;
create policy "payment_attempts_admin_roles_read"
on public.payment_attempts
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "payment_attempts_admin_roles_write" on public.payment_attempts;
create policy "payment_attempts_admin_roles_write"
on public.payment_attempts
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "ops_incidents_admin_roles_read" on public.ops_incidents;
create policy "ops_incidents_admin_roles_read"
on public.ops_incidents
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "ops_incidents_admin_roles_write" on public.ops_incidents;
create policy "ops_incidents_admin_roles_write"
on public.ops_incidents
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "suppliers_admin_roles_read" on public.suppliers;
create policy "suppliers_admin_roles_read"
on public.suppliers
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

drop policy if exists "suppliers_admin_roles_write" on public.suppliers;
create policy "suppliers_admin_roles_write"
on public.suppliers
for all
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
with check (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));

commit;
