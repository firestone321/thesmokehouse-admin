-- Phase 78: immutable manager-signed Daily Close snapshots.
begin;
create table if not exists public.daily_close_snapshots (
  id uuid primary key default gen_random_uuid(), service_date date not null unique,
  closed_by_profile_id uuid not null references public.profiles(id) on update cascade on delete restrict,
  closed_by_email_snapshot text not null, closed_by_role_snapshot public.app_role not null, closed_at timestamptz not null default now(),
  opening_float_ugx integer not null check (opening_float_ugx >= 0), cash_counted_ugx integer not null check (cash_counted_ugx >= 0), expected_pos_cash_ugx integer not null check (expected_pos_cash_ugx >= 0), cash_difference_ugx integer not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'), notes text
);
alter table public.daily_close_snapshots enable row level security;
revoke all on public.daily_close_snapshots from public, anon, authenticated;
grant select on public.daily_close_snapshots to authenticated;
grant all on public.daily_close_snapshots to service_role;
create policy "daily_close_snapshots_admin_manager_read" on public.daily_close_snapshots for select to authenticated using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role]));
create or replace function public.prevent_daily_close_snapshot_mutation() returns trigger language plpgsql as $$ begin raise exception 'daily_close_snapshot_is_immutable'; end; $$;
create trigger daily_close_snapshots_prevent_update_delete before update or delete on public.daily_close_snapshots for each row execute function public.prevent_daily_close_snapshot_mutation();
commit;