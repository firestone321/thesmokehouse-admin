begin;

-- Phase 1: reference tables and menu modeling.
-- Purpose:
-- 1. Capture the core smokehouse menu at the same grain we will later stock and sell.
-- 2. Keep the model small so daily_stock and order_items can reference portion_types directly in later phases.

create table if not exists public.proteins (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null unique,
  sort_order smallint not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint proteins_code_format_chk check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint proteins_name_not_blank_chk check (btrim(name) <> ''),
  constraint proteins_sort_order_chk check (sort_order > 0)
);

create table if not exists public.packaging_types (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null unique,
  sort_order smallint not null default 1,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint packaging_types_code_format_chk check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint packaging_types_name_not_blank_chk check (btrim(name) <> ''),
  constraint packaging_types_sort_order_chk check (sort_order > 0)
);

create table if not exists public.portion_types (
  id bigint generated always as identity primary key,
  code text not null unique,
  protein_id bigint references public.proteins(id) on update cascade on delete restrict,
  packaging_type_id bigint references public.packaging_types(id) on update cascade on delete restrict,
  name text not null,
  portion_label text,
  sort_order smallint not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint portion_types_code_format_chk check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint portion_types_name_not_blank_chk check (btrim(name) <> ''),
  constraint portion_types_portion_label_not_blank_chk check (
    portion_label is null or btrim(portion_label) <> ''
  ),
  constraint portion_types_sort_order_chk check (sort_order > 0)
);

comment on table public.proteins is
  'Top-level protein families used by the smokehouse menu. Kept small on purpose for Phase 1.';

comment on table public.packaging_types is
  'Packaging options used for sellable portions, for example clamcraft boxes and butcher paper.';

comment on table public.portion_types is
  'Sellable portion definitions at the exact grain later used by daily stock, orders, and reservations.';

comment on column public.portion_types.protein_id is
  'Nullable so non-protein menu items like juice can be represented without adding extra tables in Phase 1.';

comment on column public.portion_types.portion_label is
  'Human-readable size label such as 350g, half, or quarter.';

insert into public.proteins (code, name, sort_order)
values
  ('beef', 'Beef', 1),
  ('chicken', 'Chicken', 2),
  ('goat', 'Goat', 3)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order;

insert into public.packaging_types (code, name, sort_order, is_default)
values
  ('clamcraft_box', 'Clamcraft box', 1, true),
  ('butcher_paper', 'Butcher paper', 2, false)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_default = excluded.is_default;

insert into public.portion_types (
  code,
  protein_id,
  packaging_type_id,
  name,
  portion_label,
  sort_order
)
values
  (
    'beef_ribs_350g',
    (select id from public.proteins where code = 'beef'),
    (select id from public.packaging_types where code = 'clamcraft_box'),
    'Beef ribs',
    '350g',
    1
  ),
  (
    'beef_chunks_350g',
    (select id from public.proteins where code = 'beef'),
    (select id from public.packaging_types where code = 'butcher_paper'),
    'Beef chunks',
    '350g',
    2
  ),
  (
    'chicken_half',
    (select id from public.proteins where code = 'chicken'),
    (select id from public.packaging_types where code = 'clamcraft_box'),
    'Chicken',
    'Half',
    3
  ),
  (
    'chicken_quarter',
    (select id from public.proteins where code = 'chicken'),
    (select id from public.packaging_types where code = 'clamcraft_box'),
    'Chicken',
    'Quarter',
    4
  ),
  (
    'goat_ribs_350g',
    (select id from public.proteins where code = 'goat'),
    (select id from public.packaging_types where code = 'clamcraft_box'),
    'Goat ribs',
    '350g',
    5
  ),
  (
    'goat_chunks_350g',
    (select id from public.proteins where code = 'goat'),
    (select id from public.packaging_types where code = 'clamcraft_box'),
    'Goat chunks',
    '350g',
    6
  ),
  (
    'juice',
    null,
    null,
    'Juice',
    null,
    7
  )
on conflict (code) do update
set
  protein_id = excluded.protein_id,
  packaging_type_id = excluded.packaging_type_id,
  name = excluded.name,
  portion_label = excluded.portion_label,
  sort_order = excluded.sort_order;

commit;
