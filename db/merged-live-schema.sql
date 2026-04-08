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
    'goat_chops',
    (select id from public.proteins where code = 'goat'),
    (select id from public.packaging_types where code = 'clamcraft_box'),
    'Goat chops',
    null,
    5
  ),
  (
    'juice',
    null,
    null,
    'Juice',
    null,
    6
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
  constraint orders_status_chk check (status in ('new', 'confirmed', 'in_prep', 'on_smoker', 'ready', 'completed', 'cancelled'))
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
    from_status is null or from_status in ('new', 'confirmed', 'in_prep', 'on_smoker', 'ready', 'completed', 'cancelled')
  ),
  constraint order_status_events_to_status_chk check (
    to_status is null or to_status in ('new', 'confirmed', 'in_prep', 'on_smoker', 'ready', 'completed', 'cancelled')
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
    when v_from_status = 'in_prep' and p_to_status in ('on_smoker', 'cancelled') then true
    when v_from_status = 'on_smoker' and p_to_status in ('ready', 'cancelled') then true
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

commit;
