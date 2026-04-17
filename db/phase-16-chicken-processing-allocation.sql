begin;

-- Phase 16: chicken processing allocation.
-- Purpose:
-- 1. Process whole chicken receipts through a linked halves-vs-quarters allocation workflow.
-- 2. Keep beef and goat on the existing packed-weight and yield processing path.
-- 3. Preserve the existing processing_batches and finished_stock audit trail so processed chicken receipts close out normally.

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

comment on function public.process_procurement_receipt_to_finished_stock(
  bigint,
  bigint,
  integer,
  numeric,
  text
) is
  'Processes beef and goat protein receipts into finished frozen stock, storing post-roast packed weight and derived yield percent when available.';

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

comment on function public.process_whole_chicken_receipt_allocation(
  bigint,
  integer,
  integer,
  text
) is
  'Processes a whole chicken receipt in one allocation event, splitting birds between halves and quarters while preserving finished-stock audit records.';

commit;
