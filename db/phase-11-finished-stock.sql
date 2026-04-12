begin;

-- Phase 11: finished stock and processing.
-- Purpose:
-- 1. Track finished frozen sellable stock separately from raw procurement receipts.
-- 2. Record processing batches that convert received meat into pre-roasted frozen portions.
-- 3. Allow whole chicken receipts to be processed manually, while still honoring any saved plan when one exists.

create table if not exists public.finished_stock (
  portion_type_id bigint primary key references public.portion_types(id) on update cascade on delete restrict,
  current_quantity integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finished_stock_current_quantity_chk check (current_quantity >= 0)
);

drop trigger if exists finished_stock_set_updated_at on public.finished_stock;
create trigger finished_stock_set_updated_at
before update on public.finished_stock
for each row
execute function public.set_updated_at();

create table if not exists public.finished_stock_movements (
  id bigint generated always as identity primary key,
  portion_type_id bigint not null references public.portion_types(id) on update cascade on delete restrict,
  movement_type text not null,
  quantity_delta integer not null,
  resulting_quantity integer not null,
  processing_batch_id bigint,
  note text,
  created_at timestamptz not null default now(),
  constraint finished_stock_movements_type_chk check (movement_type in ('production', 'sale', 'adjustment', 'waste')),
  constraint finished_stock_movements_delta_nonzero_chk check (quantity_delta <> 0),
  constraint finished_stock_movements_resulting_quantity_chk check (resulting_quantity >= 0)
);

create index if not exists finished_stock_movements_portion_created_idx
  on public.finished_stock_movements (portion_type_id, created_at desc);

create table if not exists public.processing_batches (
  id bigint generated always as identity primary key,
  procurement_receipt_id bigint not null references public.procurement_receipts(id) on update cascade on delete restrict,
  portion_type_id bigint not null references public.portion_types(id) on update cascade on delete restrict,
  quantity_produced integer not null,
  note text,
  created_at timestamptz not null default now(),
  constraint processing_batches_quantity_produced_chk check (quantity_produced > 0)
);

create index if not exists processing_batches_receipt_created_idx
  on public.processing_batches (procurement_receipt_id, created_at desc);

create index if not exists processing_batches_portion_created_idx
  on public.processing_batches (portion_type_id, created_at desc);

comment on table public.finished_stock is
  'Current finished frozen sellable stock available for future orders.';

comment on table public.finished_stock_movements is
  'Audit trail for finished stock changes such as production, sales, waste, and adjustments.';

comment on table public.processing_batches is
  'Conversion records from raw procurement receipts into finished sellable frozen portions.';

create or replace function public.process_procurement_receipt_to_finished_stock(
  p_procurement_receipt_id bigint,
  p_portion_type_id bigint,
  p_quantity_produced integer,
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
  v_allowed integer;
  v_already_processed integer := 0;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_quantity_produced is null or p_quantity_produced <= 0 then
    raise exception 'Quantity produced must be greater than zero';
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
    when v_receipt.protein_code = 'whole_chicken' then 'chicken'
    when v_receipt.protein_code in ('beef_ribs', 'beef_chunks') then 'beef'
    when v_receipt.protein_code in ('goat_ribs', 'goat_chunks') then 'goat'
    else v_receipt.protein_code
  end;

  if v_receipt_protein_code is distinct from v_portion_protein_code then
    raise exception 'Receipt protein % cannot be processed into portion %', v_receipt.protein_code, v_portion_type.code;
  end if;

  if v_receipt.protein_code = 'beef_ribs' and v_portion_type.code <> 'beef_ribs_350g' then
    raise exception 'Beef ribs receipts can only be processed into beef ribs portions';
  end if;

  if v_receipt.protein_code = 'beef_chunks' and v_portion_type.code <> 'beef_chunks_350g' then
    raise exception 'Beef chunks receipts can only be processed into beef chunks portions';
  end if;

  if v_receipt.protein_code = 'goat_ribs' and v_portion_type.code <> 'goat_ribs_350g' then
    raise exception 'Goat ribs receipts can only be processed into goat ribs portions';
  end if;

  if v_receipt.protein_code = 'goat_chunks' and v_portion_type.code <> 'goat_chunks_350g' then
    raise exception 'Goat chunks receipts can only be processed into goat chunks portions';
  end if;

  if v_receipt.protein_code = 'whole_chicken' then
    if v_portion_type.code not in ('chicken_half', 'chicken_quarter') then
      raise exception 'Whole chicken receipts can only be processed into chicken half or chicken quarter portions';
    end if;

    select coalesce(sum(pb.quantity_produced), 0)
    into v_already_processed
    from public.processing_batches pb
    where pb.procurement_receipt_id = p_procurement_receipt_id
      and pb.portion_type_id = p_portion_type_id;

    if v_receipt.allocated_to_halves > 0 or v_receipt.allocated_to_quarters > 0 then
      if v_portion_type.code = 'chicken_half' then
        v_allowed := v_receipt.allocated_to_halves * 2;
      else
        v_allowed := v_receipt.allocated_to_quarters * 4;
      end if;

      if v_already_processed + p_quantity_produced > v_allowed then
        raise exception 'Processing % would exceed the planned chicken yield for receipt %', p_quantity_produced, p_procurement_receipt_id;
      end if;
    end if;
  end if;

  insert into public.processing_batches (
    procurement_receipt_id,
    portion_type_id,
    quantity_produced,
    note
  )
  values (
    p_procurement_receipt_id,
    p_portion_type_id,
    p_quantity_produced,
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
      format('Processed from procurement receipt %s', p_procurement_receipt_id)
    )
  );

  return v_finished_stock;
end;
$$;

comment on function public.process_procurement_receipt_to_finished_stock(
  bigint,
  bigint,
  integer,
  text
) is
  'Processes a protein receipt into finished frozen stock and records both the batch and stock movement.';

commit;
