begin;

-- Phase 2: daily stock.
-- Purpose:
-- 1. Store the morning prep starting quantity for each sellable portion on a given day.
-- 2. Track how much of that day's stock is reserved, sold, or wasted without introducing order tables yet.
-- 3. Keep the row shape simple enough to support exact-match reservation updates inside a transaction.
-- 4. Expose remaining stock as a first-class computed value for dashboards and reservation checks.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.daily_stock (
  stock_date date not null,
  portion_type_id bigint not null references public.portion_types(id) on update cascade on delete restrict,
  starting_quantity integer not null default 0,
  reserved_quantity integer not null default 0,
  sold_quantity integer not null default 0,
  waste_quantity integer not null default 0,
  remaining_quantity integer generated always as (
    starting_quantity - reserved_quantity - sold_quantity - waste_quantity
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_stock_pk primary key (stock_date, portion_type_id),
  constraint daily_stock_starting_quantity_chk check (starting_quantity >= 0),
  constraint daily_stock_reserved_quantity_chk check (reserved_quantity >= 0),
  constraint daily_stock_sold_quantity_chk check (sold_quantity >= 0),
  constraint daily_stock_waste_quantity_chk check (waste_quantity >= 0),
  constraint daily_stock_accounting_chk check (remaining_quantity >= 0)
);

create index if not exists daily_stock_portion_type_stock_date_idx
  on public.daily_stock (portion_type_id, stock_date desc);

drop trigger if exists daily_stock_set_updated_at on public.daily_stock;

create trigger daily_stock_set_updated_at
before update on public.daily_stock
for each row
execute function public.set_updated_at();

comment on table public.daily_stock is
  'One row per portion type per day. Stores the running portion counts the admin uses to know what is left today.';

comment on column public.daily_stock.stock_date is
  'The service day this stock row belongs to. Morning prep creates or resets these rows each day.';

comment on column public.daily_stock.starting_quantity is
  'How many portions were prepared and made available at the start of the day.';

comment on column public.daily_stock.reserved_quantity is
  'Paid or otherwise confirmed demand that is holding stock but has not yet been handed over.';

comment on column public.daily_stock.sold_quantity is
  'Reserved stock already completed and handed over to the customer.';

comment on column public.daily_stock.waste_quantity is
  'Portions lost to spoilage, damage, staff meal, or any other non-sale depletion.';

comment on column public.daily_stock.remaining_quantity is
  'Computed portions left for the service day after reservations, completed sales, and waste.';

create or replace function public.get_daily_menu_stock(p_stock_date date)
returns table (
  stock_date date,
  portion_type_id bigint,
  portion_code text,
  portion_name text,
  portion_label text,
  protein_name text,
  packaging_type_name text,
  starting_quantity integer,
  reserved_quantity integer,
  sold_quantity integer,
  waste_quantity integer,
  remaining_quantity integer,
  is_initialized boolean
)
language sql
stable
as $$
  select
    p_stock_date as stock_date,
    pt.id as portion_type_id,
    pt.code as portion_code,
    pt.name as portion_name,
    pt.portion_label,
    pr.name as protein_name,
    pkg.name as packaging_type_name,
    coalesce(ds.starting_quantity, 0) as starting_quantity,
    coalesce(ds.reserved_quantity, 0) as reserved_quantity,
    coalesce(ds.sold_quantity, 0) as sold_quantity,
    coalesce(ds.waste_quantity, 0) as waste_quantity,
    coalesce(ds.remaining_quantity, 0) as remaining_quantity,
    ds.portion_type_id is not null as is_initialized
  from public.portion_types pt
  left join public.proteins pr
    on pr.id = pt.protein_id
  left join public.packaging_types pkg
    on pkg.id = pt.packaging_type_id
  left join public.daily_stock ds
    on ds.portion_type_id = pt.id
   and ds.stock_date = p_stock_date
  where pt.is_active = true
  order by pt.sort_order, pt.id;
$$;

comment on function public.get_daily_menu_stock(date) is
  'Returns all active menu portions for a service day, including uninitialized stock rows, for dashboard use.';

alter table public.daily_stock enable row level security;

revoke insert, update, delete on public.daily_stock from anon, authenticated;

commit;
