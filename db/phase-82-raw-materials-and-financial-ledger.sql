-- Phase 82: Raw Materials and cash-movement ledger.
-- Raw Material and Resupply financial semantics: goods received are paid in cash on receipt.
-- Refund reporting semantics pending proprietor confirmation. No refund postings are created here.
begin;

create table if not exists public.raw_materials (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null,
  unit_name text not null,
  current_quantity numeric(12,2) not null default 0,
  reorder_threshold numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raw_materials_name_not_blank_chk check (btrim(name) <> ''),
  constraint raw_materials_category_chk check (category in ('edible', 'non_edible')),
  constraint raw_materials_unit_not_blank_chk check (btrim(unit_name) <> ''),
  constraint raw_materials_quantity_chk check (current_quantity >= 0),
  constraint raw_materials_threshold_chk check (reorder_threshold >= 0),
  constraint raw_materials_name_unique unique (name)
);
create index if not exists raw_materials_category_active_idx on public.raw_materials (category, is_active, name);

create table if not exists public.financial_transactions (
  id bigint generated always as identity primary key,
  direction text not null,
  amount_ugx bigint not null,
  transaction_date date not null,
  source_type text not null,
  source_id bigint,
  reference text,
  payment_method text,
  supplier_id bigint references public.suppliers(id) on update cascade on delete restrict,
  import_batch_id bigint,
  created_by uuid references public.profiles(id) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  reversal_of_transaction_id bigint references public.financial_transactions(id) on update cascade on delete restrict,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on update cascade on delete restrict,
  void_reason text,
  constraint financial_transactions_direction_chk check (direction in ('money_in', 'money_out')),
  constraint financial_transactions_amount_chk check (amount_ugx > 0),
  constraint financial_transactions_source_type_chk check (btrim(source_type) <> ''),
  constraint financial_transactions_payment_method_chk check (payment_method is null or payment_method in ('cash', 'mobile_money', 'card', 'other'))
);
create index if not exists financial_transactions_date_direction_idx on public.financial_transactions (transaction_date desc, direction);
create index if not exists financial_transactions_source_idx on public.financial_transactions (source_type, source_id);
create unique index if not exists financial_transactions_source_direction_uidx on public.financial_transactions (source_type, source_id, direction) where source_id is not null;

create table if not exists public.raw_material_import_batches (
  id bigint generated always as identity primary key,
  batch_number text not null unique,
  import_hash text not null,
  original_filename text not null,
  imported_by uuid not null references public.profiles(id) on update cascade on delete restrict,
  imported_at timestamptz not null default now(),
  row_count integer not null,
  imported_count integer not null default 0,
  total_cost_ugx bigint not null default 0,
  status text not null default 'confirmed',
  constraint raw_material_import_batches_counts_chk check (row_count >= 0 and imported_count >= 0 and imported_count <= row_count),
  constraint raw_material_import_batches_total_chk check (total_cost_ugx >= 0),
  constraint raw_material_import_batches_status_chk check (status in ('confirmed', 'voided'))
);
-- Compatibility for an earlier Phase 82 table that may already exist without
-- the idempotency column. Existing rows remain untouched and un-hashed.
do $$ begin
  if to_regclass('public.raw_material_import_batches') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'raw_material_import_batches'
         and column_name = 'import_hash'
     ) then
    alter table public.raw_material_import_batches add column import_hash text;
  end if;
end $$;
create unique index if not exists raw_material_import_batches_hash_uidx on public.raw_material_import_batches (import_hash);

create table if not exists public.raw_material_purchases (
  id bigint generated always as identity primary key,
  raw_material_id bigint not null references public.raw_materials(id) on update cascade on delete restrict,
  material_name_snapshot text not null,
  category_snapshot text not null,
  unit_snapshot text not null,
  quantity numeric(12,2) not null,
  supplier_id bigint references public.suppliers(id) on update cascade on delete restrict,
  supplier_name_snapshot text not null,
  total_cost_ugx bigint not null,
  received_date date not null,
  notes text,
  source text not null default 'manual',
  import_batch_id bigint references public.raw_material_import_batches(id) on update cascade on delete restrict,
  inventory_movement_id bigint,
  financial_transaction_id bigint,
  idempotency_key text not null,
  created_by uuid not null references public.profiles(id) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  constraint raw_material_purchases_quantity_chk check (quantity > 0),
  constraint raw_material_purchases_cost_chk check (total_cost_ugx > 0),
  constraint raw_material_purchases_category_chk check (category_snapshot in ('edible', 'non_edible')),
  constraint raw_material_purchases_source_chk check (source in ('manual', 'excel_import')),
  constraint raw_material_purchases_idempotency_key_chk check (btrim(idempotency_key) <> ''),
  constraint raw_material_purchases_idempotency_uidx unique (idempotency_key)
);

create table if not exists public.raw_material_movements (
  id bigint generated always as identity primary key,
  raw_material_id bigint not null references public.raw_materials(id) on update cascade on delete restrict,
  movement_type text not null,
  quantity_delta numeric(12,2) not null,
  resulting_quantity numeric(12,2) not null,
  purchase_id bigint,
  note text,
  created_by uuid references public.profiles(id) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  constraint raw_material_movements_type_chk check (movement_type in ('input', 'consumption', 'adjustment', 'wastage')),
  constraint raw_material_movements_delta_chk check (quantity_delta <> 0),
  constraint raw_material_movements_result_chk check (resulting_quantity >= 0)
);

-- These two links are circular by design: the purchase is the business event and the
-- movement/financial rows are its two consequences. Add them after both tables exist.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'raw_material_movements_purchase_fk') then
    alter table public.raw_material_movements add constraint raw_material_movements_purchase_fk foreign key (purchase_id) references public.raw_material_purchases(id) on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'raw_material_purchases_inventory_movement_fk') then
    alter table public.raw_material_purchases add constraint raw_material_purchases_inventory_movement_fk foreign key (inventory_movement_id) references public.raw_material_movements(id) on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'raw_material_purchases_financial_transaction_fk') then
    alter table public.raw_material_purchases add constraint raw_material_purchases_financial_transaction_fk foreign key (financial_transaction_id) references public.financial_transactions(id) on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'financial_transactions_import_batch_fk') then
    alter table public.financial_transactions add constraint financial_transactions_import_batch_fk foreign key (import_batch_id) references public.raw_material_import_batches(id) on update cascade on delete restrict;
  end if;
end $$;
create index if not exists raw_material_movements_material_created_idx on public.raw_material_movements (raw_material_id, created_at desc);
create index if not exists raw_material_purchases_received_idx on public.raw_material_purchases (received_date desc, created_at desc);
create index if not exists financial_transactions_import_batch_idx on public.financial_transactions (import_batch_id);

create or replace function public.record_raw_material_purchase(
  p_raw_material_id bigint,
  p_supplier_id bigint,
  p_quantity numeric,
  p_total_cost_ugx bigint,
  p_received_date date,
  p_notes text,
  p_source text,
  p_import_batch_id bigint,
  p_created_by uuid,
  p_idempotency_key text
)
returns table(purchase_id bigint, movement_id bigint, financial_transaction_id bigint)
language plpgsql security definer set search_path = public
as $$
declare
  v_material public.raw_materials%rowtype;
  v_actor public.profiles%rowtype;
  v_existing public.raw_material_purchases%rowtype;
  v_purchase_id bigint;
  v_movement_id bigint;
  v_financial_id bigint;
  v_supplier_name text;
  v_next_quantity numeric(12,2);
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'raw_material_idempotency_key_required'; end if;
  select * into v_existing from public.raw_material_purchases where idempotency_key = btrim(p_idempotency_key);
  if found then return query select v_existing.id, v_existing.inventory_movement_id, v_existing.financial_transaction_id; return; end if;
  if p_quantity is null or p_quantity <= 0 or p_total_cost_ugx is null or p_total_cost_ugx <= 0 or p_received_date is null then raise exception 'raw_material_purchase_values_invalid'; end if;
  if p_source not in ('manual', 'excel_import') then raise exception 'raw_material_purchase_source_invalid'; end if;
  select * into v_material from public.raw_materials where id = p_raw_material_id and is_active for update;
  if not found then raise exception 'raw_material_not_found_or_inactive'; end if;
  select name into v_supplier_name from public.suppliers where id = p_supplier_id and is_active;
  if v_supplier_name is null then raise exception 'supplier_not_found_or_inactive'; end if;
  select * into v_actor from public.profiles where id = p_created_by;
  if not found then raise exception 'staff_profile_not_found'; end if;
  v_next_quantity := v_material.current_quantity + p_quantity;
  insert into public.raw_material_purchases (raw_material_id, material_name_snapshot, category_snapshot, unit_snapshot, quantity, supplier_id, supplier_name_snapshot, total_cost_ugx, received_date, notes, source, import_batch_id, idempotency_key, created_by)
  values (v_material.id, v_material.name, v_material.category, v_material.unit_name, p_quantity, p_supplier_id, v_supplier_name, p_total_cost_ugx, p_received_date, nullif(btrim(coalesce(p_notes, '')), ''), p_source, p_import_batch_id, btrim(p_idempotency_key), p_created_by)
  returning id into v_purchase_id;
  update public.raw_materials set current_quantity = v_next_quantity, updated_at = now() where id = v_material.id;
  insert into public.raw_material_movements (raw_material_id, movement_type, quantity_delta, resulting_quantity, purchase_id, note, created_by)
  values (v_material.id, 'input', p_quantity, v_next_quantity, v_purchase_id, 'Raw Material purchase input', p_created_by)
  returning id into v_movement_id;
  insert into public.financial_transactions (direction, amount_ugx, transaction_date, source_type, source_id, reference, payment_method, supplier_id, import_batch_id, created_by)
  values ('money_out', p_total_cost_ugx, p_received_date, 'raw_material_purchase', v_purchase_id, v_material.name || ' purchase', 'cash', p_supplier_id, p_import_batch_id, p_created_by)
  returning id into v_financial_id;
  update public.raw_material_purchases set inventory_movement_id = v_movement_id, financial_transaction_id = v_financial_id where id = v_purchase_id;
  insert into public.staff_activity_log (actor_profile_id, actor_email_snapshot, actor_role_snapshot, action, entity_type, entity_id, summary, metadata)
  values (v_actor.id, v_actor.email, v_actor.role, 'raw_material.input_recorded', 'raw_material_purchase', v_purchase_id::text, v_actor.email || ' recorded a Raw Material input.', jsonb_build_object('rawMaterialId', v_material.id, 'quantity', p_quantity, 'totalCostUgx', p_total_cost_ugx, 'receivedDate', p_received_date, 'source', p_source));
  return query select v_purchase_id, v_movement_id, v_financial_id;
end;
$$;

create or replace function public.record_raw_material_import(p_batch_number text, p_import_hash text, p_filename text, p_rows jsonb, p_imported_by uuid)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_batch_id bigint;
  v_row jsonb;
  v_material public.raw_materials%rowtype;
  v_supplier_id bigint;
  v_count integer := 0;
  v_total bigint := 0;
  v_result record;
  v_quantity numeric;
  v_cost bigint;
begin
  if p_import_hash is null or btrim(p_import_hash) = '' then raise exception 'raw_material_import_hash_required'; end if;
  select id into v_batch_id from public.raw_material_import_batches where import_hash = p_import_hash;
  if found then return v_batch_id; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'raw_material_import_rows_invalid'; end if;
  insert into public.raw_material_import_batches (batch_number, import_hash, original_filename, imported_by, row_count)
  values (p_batch_number, p_import_hash, left(coalesce(p_filename, 'raw-materials.xlsx'), 255), p_imported_by, jsonb_array_length(p_rows))
  on conflict (import_hash) do nothing returning id into v_batch_id;
  if v_batch_id is null then select id into v_batch_id from public.raw_material_import_batches where import_hash = p_import_hash; return v_batch_id; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    select * into v_material from public.raw_materials where lower(name) = lower(trim(v_row->>'material')) and is_active;
    if not found then raise exception 'raw_material_import_material_invalid: %', v_row->>'material'; end if;
    select id into v_supplier_id from public.suppliers where lower(name) = lower(trim(v_row->>'supplier')) and is_active;
    if v_supplier_id is null then raise exception 'raw_material_import_supplier_invalid: %', v_row->>'supplier'; end if;
    v_quantity := (v_row->>'quantity')::numeric; v_cost := (v_row->>'totalCostUgx')::bigint;
    if v_quantity <= 0 or v_cost <= 0 then raise exception 'raw_material_import_values_invalid'; end if;
    select * into v_result from public.record_raw_material_purchase(v_material.id, v_supplier_id, v_quantity, v_cost, (v_row->>'receivedDate')::date, v_row->>'notes', 'excel_import', v_batch_id, p_imported_by, p_import_hash || ':' || v_count::text);
    v_count := v_count + 1; v_total := v_total + v_cost;
  end loop;
  update public.raw_material_import_batches set imported_count = v_count, total_cost_ugx = v_total where id = v_batch_id;
  return v_batch_id;
end;
$$;

-- New procurement receipts post one cash Money Out row. This is a trigger so all
-- current Resupply RPC variants receive the same behavior without changing callers.
create or replace function public.post_procurement_receipt_money_out()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.unit_cost is not null and new.unit_cost > 0 then
    insert into public.financial_transactions (direction, amount_ugx, transaction_date, source_type, source_id, reference, payment_method)
    values ('money_out', round(new.quantity_received * new.unit_cost)::bigint, new.delivery_date, 'procurement_receipt', new.id, new.item_name || ' resupply', 'cash')
    on conflict (source_type, source_id, direction) where source_id is not null do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists procurement_receipt_money_out_after_insert on public.procurement_receipts;
create trigger procurement_receipt_money_out_after_insert after insert on public.procurement_receipts for each row execute function public.post_procurement_receipt_money_out();

revoke all on function public.record_raw_material_purchase(bigint,bigint,numeric,bigint,date,text,text,bigint,uuid,text) from public, anon, authenticated;
revoke all on function public.record_raw_material_import(text,text,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.post_procurement_receipt_money_out() from public, anon, authenticated;
grant execute on function public.record_raw_material_purchase(bigint,bigint,numeric,bigint,date,text,text,bigint,uuid,text) to service_role;
grant execute on function public.record_raw_material_import(text,text,text,jsonb,uuid) to service_role;

alter table public.raw_materials enable row level security;
alter table public.raw_material_movements enable row level security;
alter table public.raw_material_purchases enable row level security;
alter table public.raw_material_import_batches enable row level security;
alter table public.financial_transactions enable row level security;
revoke all on public.raw_materials, public.raw_material_movements, public.raw_material_purchases, public.raw_material_import_batches, public.financial_transactions from public, anon, authenticated;
grant select on public.raw_materials, public.raw_material_movements, public.raw_material_purchases, public.raw_material_import_batches, public.financial_transactions to service_role;
grant update, insert on public.raw_materials to service_role;

insert into public.raw_materials (name, category, unit_name, reorder_threshold) values
  ('Oranges', 'edible', 'kg', 0), ('Irish potatoes', 'edible', 'kg', 0), ('Gonja', 'edible', 'clusters', 0), ('Flour', 'edible', 'kg', 0), ('Sugar', 'edible', 'kg', 0), ('Eggs', 'edible', 'trays', 0), ('Charcoal', 'non_edible', 'sacks', 0), ('Firewood', 'non_edible', 'bundles', 0)
on conflict (name) do nothing;

commit;
