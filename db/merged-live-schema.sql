begin;

-- Merged Smokehouse live schema bootstrap
-- Includes:
-- 1. Phase 1 reference tables and menu modeling
-- 2. Phase 2 daily stock
-- 3. Phase 3 core operational schema

-- ---------------------------------------------------------------------------
-- Shared trigger helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Phase 1: reference tables and menu modeling
-- ---------------------------------------------------------------------------

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
  'Top-level protein families used by the smokehouse menu.';

comment on table public.packaging_types is
  'Packaging options used for sellable portions, for example clamcraft boxes and butcher paper.';

comment on table public.portion_types is
  'Sellable portion definitions at the exact grain later used by daily stock, orders, and reservations.';

comment on column public.portion_types.protein_id is
  'Nullable so non-protein menu items like juice can be represented without adding extra tables.';

comment on column public.portion_types.portion_label is
  'Human-readable size label such as 300g, 350g, half, or quarter.';

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
    'beef_ribs_300g',
    (select id from public.proteins where code = 'beef'),
    (select id from public.packaging_types where code = 'clamcraft_box'),
    'Beef ribs',
    '300g',
    1
  ),
  (
    'beef_chunks_300g',
    (select id from public.proteins where code = 'beef'),
    (select id from public.packaging_types where code = 'butcher_paper'),
    'Beef chunks',
    '300g',
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
    'goat_ribs_300g',
    (select id from public.proteins where code = 'goat'),
    (select id from public.packaging_types where code = 'clamcraft_box'),
    'Goat ribs',
    '300g',
    5
  ),
  (
    'goat_chunks_300g',
    (select id from public.proteins where code = 'goat'),
    (select id from public.packaging_types where code = 'clamcraft_box'),
    'Goat chunks',
    '300g',
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

-- ---------------------------------------------------------------------------
-- Phase 2: daily stock
-- ---------------------------------------------------------------------------

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

alter table public.daily_stock
  add column if not exists remaining_quantity integer generated always as (
    starting_quantity - reserved_quantity - sold_quantity - waste_quantity
  ) stored;

alter table public.daily_stock
  drop constraint if exists daily_stock_accounting_chk;

alter table public.daily_stock
  add constraint daily_stock_accounting_chk check (remaining_quantity >= 0);

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

-- ---------------------------------------------------------------------------
-- Phase 3: core operational schema
-- ---------------------------------------------------------------------------

create table if not exists public.menu_categories (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null unique,
  sort_order smallint not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_categories_code_format_chk check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint menu_categories_name_not_blank_chk check (btrim(name) <> ''),
  constraint menu_categories_sort_order_chk check (sort_order > 0)
);

create table if not exists public.menu_items (
  id bigint generated always as identity primary key,
  code text not null unique,
  menu_category_id bigint not null references public.menu_categories(id) on update cascade on delete restrict,
  portion_type_id bigint not null unique references public.portion_types(id) on update cascade on delete restrict,
  name text not null,
  description text,
  image_url text,
  base_price integer not null default 0,
  prep_type text not null,
  is_active boolean not null default true,
  is_available_today boolean not null default true,
  sort_order smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_items_code_format_chk check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint menu_items_name_not_blank_chk check (btrim(name) <> ''),
  constraint menu_items_base_price_chk check (base_price >= 0),
  constraint menu_items_prep_type_chk check (prep_type in ('smoked', 'packed', 'drink')),
  constraint menu_items_sort_order_chk check (sort_order > 0)
);

create index if not exists menu_items_category_active_idx
  on public.menu_items (menu_category_id, is_active, sort_order);

alter table public.menu_items
  add column if not exists image_url text;

comment on column public.menu_items.image_url is
  'Public Supabase storage URL for the current menu item image.';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'menu-item-images',
  'menu-item-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.inventory_items (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null unique,
  unit_name text not null,
  current_quantity numeric(12,2) not null default 0,
  reorder_threshold numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items_code_format_chk check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint inventory_items_name_not_blank_chk check (btrim(name) <> ''),
  constraint inventory_items_unit_name_not_blank_chk check (btrim(unit_name) <> ''),
  constraint inventory_items_current_quantity_chk check (current_quantity >= 0),
  constraint inventory_items_reorder_threshold_chk check (reorder_threshold >= 0)
);

create index if not exists inventory_items_low_stock_idx
  on public.inventory_items (is_active, current_quantity, reorder_threshold);

create table if not exists public.inventory_movements (
  id bigint generated always as identity primary key,
  inventory_item_id bigint not null references public.inventory_items(id) on update cascade on delete restrict,
  movement_type text not null,
  quantity_delta numeric(12,2) not null,
  resulting_quantity numeric(12,2) not null,
  note text,
  created_at timestamptz not null default now(),
  constraint inventory_movements_type_chk check (movement_type in ('adjustment', 'restock', 'usage', 'waste')),
  constraint inventory_movements_delta_nonzero_chk check (quantity_delta <> 0),
  constraint inventory_movements_resulting_quantity_chk check (resulting_quantity >= 0)
);

create index if not exists inventory_movements_item_created_idx
  on public.inventory_movements (inventory_item_id, created_at desc);

create table if not exists public.menu_item_components (
  id bigint generated always as identity primary key,
  menu_item_id bigint not null references public.menu_items(id) on update cascade on delete cascade,
  inventory_item_id bigint not null references public.inventory_items(id) on update cascade on delete restrict,
  quantity_required numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint menu_item_components_quantity_chk check (quantity_required > 0),
  constraint menu_item_components_unique unique (menu_item_id, inventory_item_id)
);

create index if not exists menu_item_components_menu_item_idx
  on public.menu_item_components (menu_item_id);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  order_number text not null unique,
  customer_name text,
  customer_phone text,
  status text not null default 'new',
  notes text,
  total_amount integer not null default 0,
  promised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint orders_number_not_blank_chk check (btrim(order_number) <> ''),
  constraint orders_total_amount_chk check (total_amount >= 0),
  constraint orders_status_chk check (status in ('new', 'confirmed', 'in_prep', 'ready', 'completed', 'cancelled'))
);

create index if not exists orders_status_created_idx
  on public.orders (status, created_at desc);

create index if not exists orders_created_idx
  on public.orders (created_at desc);

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on update cascade on delete cascade,
  menu_item_id bigint not null references public.menu_items(id) on update cascade on delete restrict,
  menu_item_name text not null,
  quantity integer not null,
  unit_price integer not null,
  line_total integer generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now(),
  constraint order_items_name_not_blank_chk check (btrim(menu_item_name) <> ''),
  constraint order_items_quantity_chk check (quantity > 0),
  constraint order_items_unit_price_chk check (unit_price >= 0)
);

create index if not exists order_items_order_idx
  on public.order_items (order_id);

create table if not exists public.order_status_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on update cascade on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now(),
  constraint order_status_events_type_chk check (event_type in ('created', 'status_changed', 'note_added')),
  constraint order_status_events_from_status_chk check (
    from_status is null or from_status in ('new', 'confirmed', 'in_prep', 'ready', 'completed', 'cancelled')
  ),
  constraint order_status_events_to_status_chk check (
    to_status is null or to_status in ('new', 'confirmed', 'in_prep', 'ready', 'completed', 'cancelled')
  )
);

create index if not exists order_status_events_order_created_idx
  on public.order_status_events (order_id, created_at desc);

create table if not exists public.ops_incidents (
  id bigint generated always as identity primary key,
  title text not null,
  detail text,
  severity text not null default 'warning',
  status text not null default 'open',
  owner text,
  related_order_id bigint references public.orders(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint ops_incidents_title_not_blank_chk check (btrim(title) <> ''),
  constraint ops_incidents_severity_chk check (severity in ('warning', 'critical')),
  constraint ops_incidents_status_chk check (status in ('open', 'resolved'))
);

create index if not exists ops_incidents_status_created_idx
  on public.ops_incidents (status, created_at desc);

drop trigger if exists menu_categories_set_updated_at on public.menu_categories;
create trigger menu_categories_set_updated_at
before update on public.menu_categories
for each row
execute function public.set_updated_at();

drop trigger if exists menu_items_set_updated_at on public.menu_items;
create trigger menu_items_set_updated_at
before update on public.menu_items
for each row
execute function public.set_updated_at();

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row
execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

drop trigger if exists ops_incidents_set_updated_at on public.ops_incidents;
create trigger ops_incidents_set_updated_at
before update on public.ops_incidents
for each row
execute function public.set_updated_at();

create or replace function public.recalculate_order_total(p_order_id bigint)
returns void
language plpgsql
as $$
begin
  update public.orders
  set total_amount = coalesce(
    (
      select sum(line_total)
      from public.order_items
      where order_id = p_order_id
    ),
    0
  )
  where id = p_order_id;
end;
$$;

create or replace function public.sync_order_total_from_items()
returns trigger
language plpgsql
as $$
declare
  v_order_id bigint;
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  perform public.recalculate_order_total(v_order_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists order_items_recalculate_total on public.order_items;
create trigger order_items_recalculate_total
after insert or update or delete on public.order_items
for each row
execute function public.sync_order_total_from_items();

create or replace function public.log_order_created()
returns trigger
language plpgsql
as $$
begin
  insert into public.order_status_events (
    order_id,
    event_type,
    from_status,
    to_status,
    note
  )
  values (
    new.id,
    'created',
    null,
    new.status,
    new.notes
  );

  return new;
end;
$$;

drop trigger if exists orders_log_created_event on public.orders;
create trigger orders_log_created_event
after insert on public.orders
for each row
execute function public.log_order_created();

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

create or replace function public.add_order_note(
  p_order_id bigint,
  p_note text
)
returns public.order_status_events
language plpgsql
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_event public.order_status_events%rowtype;
begin
  if v_note is null then
    raise exception 'Order note cannot be blank';
  end if;

  update public.orders
  set notes = case
    when notes is null or btrim(notes) = '' then v_note
    else notes || E'\n\n' || v_note
  end
  where id = p_order_id;

  insert into public.order_status_events (
    order_id,
    event_type,
    from_status,
    to_status,
    note
  )
  select
    id,
    'note_added',
    status,
    status,
    v_note
  from public.orders
  where id = p_order_id
  returning *
  into v_event;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  return v_event;
end;
$$;

create or replace function public.apply_inventory_adjustment(
  p_inventory_item_id bigint,
  p_quantity_delta numeric(12,2),
  p_movement_type text default 'adjustment',
  p_note text default null
)
returns public.inventory_items
language plpgsql
as $$
declare
  v_item public.inventory_items%rowtype;
  v_new_quantity numeric(12,2);
begin
  if p_quantity_delta = 0 then
    raise exception 'Inventory adjustment delta cannot be zero';
  end if;

  if p_movement_type not in ('adjustment', 'restock', 'usage', 'waste') then
    raise exception 'Invalid inventory movement type: %', p_movement_type;
  end if;

  select *
  into v_item
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if not found then
    raise exception 'Inventory item % not found', p_inventory_item_id;
  end if;

  v_new_quantity := v_item.current_quantity + p_quantity_delta;

  if v_new_quantity < 0 then
    raise exception 'Inventory item % would go negative', p_inventory_item_id;
  end if;

  update public.inventory_items
  set current_quantity = v_new_quantity
  where id = p_inventory_item_id
  returning *
  into v_item;

  insert into public.inventory_movements (
    inventory_item_id,
    movement_type,
    quantity_delta,
    resulting_quantity,
    note
  )
  values (
    v_item.id,
    p_movement_type,
    p_quantity_delta,
    v_item.current_quantity,
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return v_item;
end;
$$;

insert into public.menu_categories (code, name, sort_order)
values
  ('beef', 'Beef', 1),
  ('chicken', 'Chicken', 2),
  ('goat', 'Goat', 3),
  ('drinks', 'Drinks', 4)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Phase 10: storefront shared-order support
-- ---------------------------------------------------------------------------

create sequence if not exists public.order_number_seq
  start with 1000
  increment by 1
  minvalue 1000;

create or replace function public.generate_order_number()
returns text
language plpgsql
as $$
declare
  v_next bigint;
begin
  v_next := nextval('public.order_number_seq');
  return v_next::text;
end;
$$;

with existing_numbers as (
  select max(order_number::bigint) as max_order_number
  from public.orders
  where order_number ~ '^[0-9]+$'
)
select setval(
  'public.order_number_seq',
  coalesce((select max_order_number from existing_numbers), 1000),
  coalesce((select max_order_number is not null from existing_numbers), false)
);

alter table public.orders
  alter column order_number set default public.generate_order_number();

alter table public.orders
  add column if not exists public_token text;

alter table public.orders
  add column if not exists pickup_code text;

comment on column public.orders.public_token is
  'Customer-facing tracking token used by the storefront order status page.';

comment on column public.orders.pickup_code is
  'Short pickup handoff code shown to the customer after checkout.';

create unique index if not exists orders_public_token_key
  on public.orders (public_token)
  where public_token is not null;

alter table public.orders
  drop constraint if exists orders_pickup_code_format_chk;

alter table public.orders
  add constraint orders_pickup_code_format_chk
  check (pickup_code is null or pickup_code ~ '^[0-9]{4}$');

-- ---------------------------------------------------------------------------
-- Phase 16: chicken processing allocation
-- ---------------------------------------------------------------------------

create or replace function public.process_procurement_receipt_to_finished_stock(
  p_procurement_receipt_id bigint,
  p_portion_type_id bigint,
  p_quantity_produced integer,
  p_post_roast_packed_weight_kg numeric(10,3) default null,
  p_note text default null
)
returns public.finished_stock
language plpgsql
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_portion_type public.portion_types%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_batch public.processing_batches%rowtype;
  v_receipt_protein_code text;
  v_portion_protein_code text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_post_roast_packed_weight_kg numeric(10,3) := p_post_roast_packed_weight_kg;
  v_yield_percent numeric(6,2) := null;
begin
  if p_quantity_produced is null or p_quantity_produced <= 0 then
    raise exception 'Quantity produced must be greater than zero';
  end if;

  if v_post_roast_packed_weight_kg is not null and v_post_roast_packed_weight_kg <= 0 then
    raise exception 'Post-roast packed weight must be greater than zero when provided';
  end if;

  select *
  into v_receipt
  from public.procurement_receipts
  where id = p_procurement_receipt_id
  for update;

  if not found then
    raise exception 'Procurement receipt % not found', p_procurement_receipt_id;
  end if;

  if v_receipt.intake_type <> 'protein' then
    raise exception 'Only protein receipts can be processed into finished stock';
  end if;

  if v_receipt.protein_code = 'whole_chicken' then
    raise exception 'Whole chicken receipts must be processed with the chicken allocation workflow';
  end if;

  if v_post_roast_packed_weight_kg is not null and v_receipt.quantity_received is not null and v_post_roast_packed_weight_kg > v_receipt.quantity_received then
    raise exception 'Post-roast packed weight cannot exceed raw receipt weight';
  end if;

  if v_post_roast_packed_weight_kg is not null and v_receipt.quantity_received is not null and v_receipt.quantity_received > 0 then
    v_yield_percent := round((v_post_roast_packed_weight_kg / v_receipt.quantity_received) * 100, 2);
  end if;

  select pt.*
  into v_portion_type
  from public.portion_types pt
  where pt.id = p_portion_type_id;

  if not found then
    raise exception 'Portion type % not found', p_portion_type_id;
  end if;

  if not v_portion_type.is_active then
    raise exception 'Portion type % is not active', p_portion_type_id;
  end if;

  select pr.code
  into v_portion_protein_code
  from public.proteins pr
  where pr.id = v_portion_type.protein_id;

  v_receipt_protein_code := case
    when v_receipt.protein_code in ('beef_ribs', 'beef_chunks') then 'beef'
    when v_receipt.protein_code in ('goat_ribs', 'goat_chunks') then 'goat'
    else v_receipt.protein_code
  end;

  if v_receipt_protein_code is distinct from v_portion_protein_code then
    raise exception 'Receipt protein % cannot be processed into portion %', v_receipt.protein_code, v_portion_type.code;
  end if;

  if v_receipt.protein_code = 'beef_ribs' and v_portion_type.code <> 'beef_ribs_300g' then
    raise exception 'Beef ribs receipts can only be processed into beef ribs portions';
  end if;

  if v_receipt.protein_code = 'beef_chunks' and v_portion_type.code <> 'beef_chunks_300g' then
    raise exception 'Beef chunks receipts can only be processed into beef chunks portions';
  end if;

  if v_receipt.protein_code = 'goat_ribs' and v_portion_type.code <> 'goat_ribs_300g' then
    raise exception 'Goat ribs receipts can only be processed into goat ribs portions';
  end if;

  if v_receipt.protein_code = 'goat_chunks' and v_portion_type.code <> 'goat_chunks_300g' then
    raise exception 'Goat chunks receipts can only be processed into goat chunks portions';
  end if;

  insert into public.processing_batches (
    procurement_receipt_id,
    portion_type_id,
    quantity_produced,
    post_roast_packed_weight_kg,
    yield_percent,
    note
  )
  values (
    p_procurement_receipt_id,
    p_portion_type_id,
    p_quantity_produced,
    v_post_roast_packed_weight_kg,
    v_yield_percent,
    v_note
  )
  returning *
  into v_batch;

  insert into public.finished_stock (
    portion_type_id,
    current_quantity
  )
  values (
    p_portion_type_id,
    p_quantity_produced
  )
  on conflict (portion_type_id) do update
  set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
  returning *
  into v_finished_stock;

  insert into public.finished_stock_movements (
    portion_type_id,
    movement_type,
    quantity_delta,
    resulting_quantity,
    processing_batch_id,
    note
  )
  values (
    p_portion_type_id,
    'production',
    p_quantity_produced,
    v_finished_stock.current_quantity,
    v_batch.id,
    coalesce(
      v_note,
      case
        when v_receipt.batch_number is not null then
          format('Processed from batch %s (receipt %s)', v_receipt.batch_number, p_procurement_receipt_id)
        else
          format('Processed from procurement receipt %s', p_procurement_receipt_id)
      end
    )
  );

  return v_finished_stock;
end;
$$;

create or replace function public.process_whole_chicken_receipt_allocation(
  p_procurement_receipt_id bigint,
  p_birds_allocated_to_halves integer,
  p_birds_allocated_to_quarters integer,
  p_note text default null
)
returns void
language plpgsql
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_half_portion_id bigint;
  v_quarter_portion_id bigint;
  v_total_birds integer;
  v_half_output integer;
  v_quarter_output integer;
  v_half_batch public.processing_batches%rowtype;
  v_quarter_batch public.processing_batches%rowtype;
  v_finished_stock public.finished_stock%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_birds_allocated_to_halves is null then
    raise exception 'Birds allocated to halves is required';
  end if;

  if p_birds_allocated_to_quarters is null then
    raise exception 'Birds allocated to quarters is required';
  end if;

  if p_birds_allocated_to_halves < 0 then
    raise exception 'Birds allocated to halves must be greater than or equal to zero';
  end if;

  if p_birds_allocated_to_quarters < 0 then
    raise exception 'Birds allocated to quarters must be greater than or equal to zero';
  end if;

  select *
  into v_receipt
  from public.procurement_receipts
  where id = p_procurement_receipt_id
  for update;

  if not found then
    raise exception 'Procurement receipt % not found', p_procurement_receipt_id;
  end if;

  if v_receipt.intake_type <> 'protein' or v_receipt.protein_code <> 'whole_chicken' then
    raise exception 'Receipt % is not a whole chicken receipt', p_procurement_receipt_id;
  end if;

  if v_receipt.quantity_received is null or v_receipt.quantity_received < 0 then
    raise exception 'Whole chicken receipt % must have a non-negative bird count', p_procurement_receipt_id;
  end if;

  if trunc(v_receipt.quantity_received) <> v_receipt.quantity_received then
    raise exception 'Whole chicken receipt % must have a whole-number bird count', p_procurement_receipt_id;
  end if;

  v_total_birds := v_receipt.quantity_received::integer;

  if v_total_birds <= 0 then
    raise exception 'Whole chicken receipt % must have at least one bird to process', p_procurement_receipt_id;
  end if;

  if p_birds_allocated_to_halves > v_total_birds then
    raise exception 'Birds allocated to halves cannot exceed total birds on the receipt';
  end if;

  if p_birds_allocated_to_quarters > v_total_birds then
    raise exception 'Birds allocated to quarters cannot exceed total birds on the receipt';
  end if;

  if p_birds_allocated_to_halves + p_birds_allocated_to_quarters <> v_total_birds then
    raise exception 'Birds allocated to halves plus quarters must equal the total birds on the receipt';
  end if;

  if exists (
    select 1
    from public.processing_batches pb
    where pb.procurement_receipt_id = p_procurement_receipt_id
  ) then
    raise exception 'Whole chicken receipt % already has a completed processing batch', p_procurement_receipt_id;
  end if;

  select pt.id
  into v_half_portion_id
  from public.portion_types pt
  where pt.code = 'chicken_half'
    and pt.is_active = true;

  if v_half_portion_id is null then
    raise exception 'Chicken half portion type is missing or inactive';
  end if;

  select pt.id
  into v_quarter_portion_id
  from public.portion_types pt
  where pt.code = 'chicken_quarter'
    and pt.is_active = true;

  if v_quarter_portion_id is null then
    raise exception 'Chicken quarter portion type is missing or inactive';
  end if;

  update public.procurement_receipts
  set
    allocated_to_halves = p_birds_allocated_to_halves,
    allocated_to_quarters = p_birds_allocated_to_quarters
  where id = p_procurement_receipt_id;

  v_half_output := p_birds_allocated_to_halves * 2;
  v_quarter_output := p_birds_allocated_to_quarters * 4;

  if v_half_output > 0 then
    insert into public.processing_batches (
      procurement_receipt_id,
      portion_type_id,
      quantity_produced,
      note
    )
    values (
      p_procurement_receipt_id,
      v_half_portion_id,
      v_half_output,
      v_note
    )
    returning *
    into v_half_batch;

    insert into public.finished_stock (
      portion_type_id,
      current_quantity
    )
    values (
      v_half_portion_id,
      v_half_output
    )
    on conflict (portion_type_id) do update
    set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
    returning *
    into v_finished_stock;

    insert into public.finished_stock_movements (
      portion_type_id,
      movement_type,
      quantity_delta,
      resulting_quantity,
      processing_batch_id,
      note
    )
    values (
      v_half_portion_id,
      'production',
      v_half_output,
      v_finished_stock.current_quantity,
      v_half_batch.id,
      coalesce(
        v_note,
        case
          when v_receipt.batch_number is not null then
            format('Processed chicken halves from batch %s (receipt %s)', v_receipt.batch_number, p_procurement_receipt_id)
          else
            format('Processed chicken halves from procurement receipt %s', p_procurement_receipt_id)
        end
      )
    );
  end if;

  if v_quarter_output > 0 then
    insert into public.processing_batches (
      procurement_receipt_id,
      portion_type_id,
      quantity_produced,
      note
    )
    values (
      p_procurement_receipt_id,
      v_quarter_portion_id,
      v_quarter_output,
      v_note
    )
    returning *
    into v_quarter_batch;

    insert into public.finished_stock (
      portion_type_id,
      current_quantity
    )
    values (
      v_quarter_portion_id,
      v_quarter_output
    )
    on conflict (portion_type_id) do update
    set current_quantity = public.finished_stock.current_quantity + excluded.current_quantity
    returning *
    into v_finished_stock;

    insert into public.finished_stock_movements (
      portion_type_id,
      movement_type,
      quantity_delta,
      resulting_quantity,
      processing_batch_id,
      note
    )
    values (
      v_quarter_portion_id,
      'production',
      v_quarter_output,
      v_finished_stock.current_quantity,
      v_quarter_batch.id,
      coalesce(
        v_note,
        case
          when v_receipt.batch_number is not null then
            format('Processed chicken quarters from batch %s (receipt %s)', v_receipt.batch_number, p_procurement_receipt_id)
          else
            format('Processed chicken quarters from procurement receipt %s', p_procurement_receipt_id)
        end
      )
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Phase 17: ingredient intake
-- ---------------------------------------------------------------------------

alter table public.inventory_items
  add column if not exists item_type text;

update public.inventory_items
set item_type = 'supply'
where item_type is null;

alter table public.inventory_items
  alter column item_type set default 'supply';

alter table public.inventory_items
  alter column item_type set not null;

alter table public.inventory_items
  drop constraint if exists inventory_items_item_type_chk;

alter table public.inventory_items
  add constraint inventory_items_item_type_chk check (item_type in ('ingredient', 'supply'));

create index if not exists inventory_items_type_active_name_idx
  on public.inventory_items (item_type, is_active, name);

insert into public.inventory_items (
  code,
  name,
  unit_name,
  item_type,
  current_quantity,
  reorder_threshold,
  is_active
)
values
  ('fries_kg', 'Fries input', 'kg', 'ingredient', 0, 0, true),
  ('gonja_kg', 'Gonja input', 'kg', 'ingredient', 0, 0, true)
on conflict (code) do update
set
  name = excluded.name,
  unit_name = excluded.unit_name,
  item_type = excluded.item_type,
  is_active = excluded.is_active,
  updated_at = now();

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_intake_type_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_intake_type_chk check (
    intake_type in ('protein', 'ingredient', 'supply')
  );

alter table public.procurement_receipts
  drop constraint if exists procurement_receipts_source_chk;

alter table public.procurement_receipts
  add constraint procurement_receipts_source_chk check (
    (intake_type = 'protein' and protein_code is not null and inventory_item_id is null) or
    (intake_type in ('ingredient', 'supply') and protein_code is null and inventory_item_id is not null)
  );

create or replace function public.record_procurement_receipt(
  p_intake_type text,
  p_protein_code text default null,
  p_inventory_item_id bigint default null,
  p_supplier_id bigint default null,
  p_supplier_name text default null,
  p_batch_number text default null,
  p_delivery_date date default null,
  p_butchered_on date default null,
  p_abattoir_name text default null,
  p_vet_stamp_number text default null,
  p_inspection_officer_name text default null,
  p_quantity_received numeric(12,2) default null,
  p_unit_name text default null,
  p_unit_cost numeric(12,2) default null,
  p_note text default null,
  p_allocated_to_halves integer default 0,
  p_allocated_to_quarters integer default 0
)
returns public.procurement_receipts
language plpgsql
as $$
declare
  v_receipt public.procurement_receipts%rowtype;
  v_inventory_item public.inventory_items%rowtype;
  v_supplier public.suppliers%rowtype;
  v_item_name text;
  v_supplier_name text;
  v_unit_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_abattoir_name text := nullif(btrim(coalesce(p_abattoir_name, '')), '');
  v_vet_stamp_number text := nullif(btrim(coalesce(p_vet_stamp_number, '')), '');
  v_inspection_officer_name text := nullif(btrim(coalesce(p_inspection_officer_name, '')), '');
begin
  if p_intake_type not in ('protein', 'ingredient', 'supply') then
    raise exception 'Invalid procurement intake type: %', p_intake_type;
  end if;

  if p_delivery_date is null then
    raise exception 'Delivery date is required';
  end if;

  if p_quantity_received is null or p_quantity_received <= 0 then
    raise exception 'Quantity received must be greater than zero';
  end if;

  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Unit cost cannot be negative';
  end if;

  if p_allocated_to_halves < 0 or p_allocated_to_quarters < 0 then
    raise exception 'Chicken allocations cannot be negative';
  end if;

  if p_supplier_id is not null then
    select *
    into v_supplier
    from public.suppliers
    where id = p_supplier_id;

    if not found then
      raise exception 'Supplier % not found', p_supplier_id;
    end if;
  end if;

  if p_intake_type = 'protein' then
    if p_supplier_id is null then
      raise exception 'Supplier is required for protein receipts';
    end if;

    if p_protein_code not in (
      'beef_ribs',
      'beef_chunks',
      'whole_chicken',
      'goat_ribs',
      'goat_chunks',
      'beef',
      'goat'
    ) then
      raise exception 'Invalid protein procurement code: %', p_protein_code;
    end if;

    if v_batch_number is null then
      raise exception 'Batch number is required for protein receipts';
    end if;

    if p_butchered_on is null then
      raise exception 'Butchered date is required for protein receipts';
    end if;

    if p_butchered_on > p_delivery_date then
      raise exception 'Butchered date cannot be after delivery date';
    end if;

    if v_abattoir_name is null then
      v_abattoir_name := nullif(btrim(coalesce(v_supplier.default_abattoir_name, '')), '');
    end if;

    if v_abattoir_name is null then
      raise exception 'Abattoir name is required for protein receipts';
    end if;

    if v_vet_stamp_number is null then
      raise exception 'Vet stamp number is required for protein receipts';
    end if;

    if v_inspection_officer_name is null then
      raise exception 'Inspection officer name is required for protein receipts';
    end if;

    v_supplier_name := v_supplier.name;

    v_item_name := case p_protein_code
      when 'beef_ribs' then 'Beef ribs'
      when 'beef_chunks' then 'Beef chunks'
      when 'whole_chicken' then 'Whole chicken'
      when 'goat_ribs' then 'Goat ribs'
      when 'goat_chunks' then 'Goat chunks'
      when 'beef' then 'Beef'
      when 'goat' then 'Goat meat'
    end;

    v_unit_name := nullif(btrim(coalesce(p_unit_name, '')), '');

    if v_unit_name is null then
      v_unit_name := case p_protein_code
        when 'beef_ribs' then 'kg'
        when 'beef_chunks' then 'kg'
        when 'whole_chicken' then 'bird'
        when 'goat_ribs' then 'kg'
        when 'goat_chunks' then 'kg'
        when 'beef' then 'kg'
        when 'goat' then 'kg'
      end;
    end if;

    if p_protein_code = 'whole_chicken' and trunc(p_quantity_received) <> p_quantity_received then
      raise exception 'Whole chicken quantity must be a whole number';
    end if;

    if p_protein_code = 'whole_chicken' then
      if p_allocated_to_halves + p_allocated_to_quarters > p_quantity_received then
        raise exception 'Chicken allocations cannot exceed whole chickens received';
      end if;
    elsif p_allocated_to_halves <> 0 or p_allocated_to_quarters <> 0 then
      raise exception 'Chicken allocations are only allowed for whole chicken receipts';
    end if;
  else
    if v_supplier.name is not null then
      v_supplier_name := v_supplier.name;
    elsif nullif(btrim(coalesce(p_supplier_name, '')), '') is not null then
      v_supplier_name := btrim(p_supplier_name);
    else
      raise exception 'Supplier name is required';
    end if;

    select *
    into v_inventory_item
    from public.inventory_items
    where id = p_inventory_item_id
    for update;

    if not found then
      raise exception 'Inventory item % not found', p_inventory_item_id;
    end if;

    if p_intake_type = 'ingredient' and v_inventory_item.item_type <> 'ingredient' then
      raise exception 'Inventory item % is not configured as an ingredient item', p_inventory_item_id;
    end if;

    if p_intake_type = 'supply' and v_inventory_item.item_type <> 'supply' then
      raise exception 'Inventory item % is not configured as a supply item', p_inventory_item_id;
    end if;

    v_item_name := v_inventory_item.name;
    v_unit_name := v_inventory_item.unit_name;
    p_protein_code := null;
    p_allocated_to_halves := 0;
    p_allocated_to_quarters := 0;
    p_butchered_on := null;
    v_batch_number := null;
    v_abattoir_name := null;
    v_vet_stamp_number := null;
    v_inspection_officer_name := null;
  end if;

  insert into public.procurement_receipts (
    intake_type,
    protein_code,
    inventory_item_id,
    supplier_id,
    supplier_name,
    batch_number,
    delivery_date,
    butchered_on,
    abattoir_name,
    vet_stamp_number,
    inspection_officer_name,
    item_name,
    quantity_received,
    unit_name,
    unit_cost,
    note,
    allocated_to_halves,
    allocated_to_quarters
  )
  values (
    p_intake_type,
    p_protein_code,
    p_inventory_item_id,
    p_supplier_id,
    v_supplier_name,
    v_batch_number,
    p_delivery_date,
    p_butchered_on,
    v_abattoir_name,
    v_vet_stamp_number,
    v_inspection_officer_name,
    v_item_name,
    p_quantity_received,
    v_unit_name,
    p_unit_cost,
    v_note,
    p_allocated_to_halves,
    p_allocated_to_quarters
  )
  returning *
  into v_receipt;

  if p_intake_type in ('ingredient', 'supply') then
    perform public.apply_inventory_adjustment(
      v_inventory_item.id,
      p_quantity_received,
      'restock',
      coalesce(
        v_note,
        format('Procurement receipt from %s on %s', v_supplier_name, p_delivery_date)
      )
    );
  end if;

  return v_receipt;
end;
$$;

-- ---------------------------------------------------------------------------
-- Phase 18: supplier intake segmentation
-- ---------------------------------------------------------------------------

alter table public.suppliers
  drop constraint if exists suppliers_supplier_type_chk;

alter table public.suppliers
  add constraint suppliers_supplier_type_chk check (
    supplier_type in ('protein', 'ingredient', 'supply', 'mixed')
  );

update public.suppliers as s
set supplier_type = 'ingredient'
where supplier_type = 'supply'
  and exists (
    select 1
    from public.procurement_receipts pr
    where pr.supplier_id = s.id
      and pr.intake_type = 'ingredient'
  )
  and not exists (
    select 1
    from public.procurement_receipts pr
    where pr.supplier_id = s.id
      and pr.intake_type in ('protein', 'supply')
  );

commit;
