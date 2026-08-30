-- Phase 83: internal cash movement and daily cash reconciliation.
-- Internal transfers never contribute to Money In or Money Out.
-- Historical account balances, refunds, and variance accounting remain deferred.
begin;

create table if not exists public.financial_accounts (
  id bigint generated always as identity primary key,
  name text not null,
  account_type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_accounts_name_not_blank_chk check (btrim(name) <> ''),
  constraint financial_accounts_type_chk check (account_type in ('cash', 'mobile_money', 'bank')),
  constraint financial_accounts_name_uidx unique (name)
);

create table if not exists public.financial_transfers (
  id bigint generated always as identity primary key,
  transfer_number text not null default ('TRF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  from_account_id bigint not null references public.financial_accounts(id) on update cascade on delete restrict,
  to_account_id bigint not null references public.financial_accounts(id) on update cascade on delete restrict,
  amount_ugx bigint not null,
  service_date date not null,
  transferred_at timestamptz not null,
  external_reference text,
  notes text,
  fee_amount_ugx bigint not null default 0,
  fee_financial_transaction_id bigint references public.financial_transactions(id) on update cascade on delete restrict,
  created_by uuid not null references public.profiles(id) on update cascade on delete restrict,
  created_by_email_snapshot text not null,
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id) on update cascade on delete restrict,
  reversal_reason text,
  constraint financial_transfers_number_uidx unique (transfer_number),
  constraint financial_transfers_amount_chk check (amount_ugx > 0),
  constraint financial_transfers_fee_chk check (fee_amount_ugx >= 0),
  constraint financial_transfers_accounts_differ_chk check (from_account_id <> to_account_id),
  constraint financial_transfers_idempotency_not_blank_chk check (btrim(idempotency_key) <> ''),
  constraint financial_transfers_idempotency_uidx unique (idempotency_key)
);

create table if not exists public.financial_account_movements (
  id bigint generated always as identity primary key,
  account_id bigint not null references public.financial_accounts(id) on update cascade on delete restrict,
  transfer_id bigint not null references public.financial_transfers(id) on update cascade on delete restrict,
  amount_delta_ugx bigint not null,
  service_date date not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint financial_account_movements_nonzero_chk check (amount_delta_ugx <> 0),
  constraint financial_account_movements_transfer_account_uidx unique (transfer_id, account_id)
);

create index if not exists financial_transfers_service_date_idx
  on public.financial_transfers (service_date desc, transferred_at desc, id desc);
create index if not exists financial_transfers_from_date_idx
  on public.financial_transfers (from_account_id, service_date desc);
create index if not exists financial_transfers_to_date_idx
  on public.financial_transfers (to_account_id, service_date desc);
create index if not exists financial_account_movements_account_date_idx
  on public.financial_account_movements (account_id, service_date desc, occurred_at desc);

insert into public.financial_accounts (name, account_type)
values ('Cash', 'cash'), ('Mobile Money', 'mobile_money')
on conflict (name) do nothing;

alter table public.daily_close_snapshots add column if not exists expected_cash_ugx bigint;
alter table public.daily_close_snapshots add column if not exists cash_money_out_ugx bigint;
alter table public.daily_close_snapshots add column if not exists cash_transfers_out_ugx bigint;
alter table public.daily_close_snapshots add column if not exists cash_transfers_in_ugx bigint;
alter table public.daily_close_snapshots add column if not exists deposit_expected boolean;
alter table public.daily_close_snapshots add column if not exists mobile_money_deposit_recorded boolean;
alter table public.daily_close_snapshots add column if not exists counted_by_profile_id uuid references public.profiles(id) on update cascade on delete restrict;
alter table public.daily_close_snapshots add column if not exists counted_at timestamptz;

create or replace function public.record_financial_transfer(
  p_from_account_id bigint,
  p_to_account_id bigint,
  p_amount_ugx bigint,
  p_transferred_at timestamptz,
  p_external_reference text,
  p_notes text,
  p_fee_amount_ugx bigint,
  p_created_by uuid,
  p_idempotency_key text
)
returns table(transfer_id bigint, transfer_number text, fee_financial_transaction_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.financial_accounts%rowtype;
  v_to public.financial_accounts%rowtype;
  v_actor public.profiles%rowtype;
  v_existing public.financial_transfers%rowtype;
  v_transfer_id bigint;
  v_transfer_number text;
  v_fee_transaction_id bigint;
  v_service_date date;
  v_fee bigint := coalesce(p_fee_amount_ugx, 0);
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'financial_transfer_idempotency_key_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_idempotency_key), 0));

  select * into v_existing
  from public.financial_transfers
  where idempotency_key = btrim(p_idempotency_key);

  if found then
    if v_existing.from_account_id <> p_from_account_id
       or v_existing.to_account_id <> p_to_account_id
       or v_existing.amount_ugx <> p_amount_ugx
       or v_existing.fee_amount_ugx <> v_fee then
      raise exception 'financial_transfer_idempotency_conflict';
    end if;
    return query select v_existing.id, v_existing.transfer_number, v_existing.fee_financial_transaction_id;
    return;
  end if;

  if p_from_account_id is null or p_to_account_id is null or p_from_account_id = p_to_account_id then
    raise exception 'financial_transfer_accounts_invalid';
  end if;
  if p_amount_ugx is null or p_amount_ugx <= 0 or v_fee < 0 or p_transferred_at is null then
    raise exception 'financial_transfer_values_invalid';
  end if;

  select * into v_from from public.financial_accounts where id = p_from_account_id and is_active for share;
  if not found then raise exception 'financial_transfer_from_account_invalid'; end if;
  select * into v_to from public.financial_accounts where id = p_to_account_id and is_active for share;
  if not found then raise exception 'financial_transfer_to_account_invalid'; end if;
  select * into v_actor from public.profiles where id = p_created_by;
  if not found or v_actor.role not in ('admin', 'manager') then raise exception 'financial_transfer_actor_not_authorized'; end if;

  v_service_date := (p_transferred_at at time zone 'Africa/Kampala')::date;

  insert into public.financial_transfers (
    from_account_id, to_account_id, amount_ugx, service_date, transferred_at,
    external_reference, notes, fee_amount_ugx, created_by, created_by_email_snapshot, idempotency_key
  ) values (
    v_from.id, v_to.id, p_amount_ugx, v_service_date, p_transferred_at,
    nullif(btrim(coalesce(p_external_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), v_fee, p_created_by,
    coalesce(v_actor.email, 'Unknown manager'), btrim(p_idempotency_key)
  )
  returning id, financial_transfers.transfer_number into v_transfer_id, v_transfer_number;

  insert into public.financial_account_movements (account_id, transfer_id, amount_delta_ugx, service_date, occurred_at)
  values
    (v_from.id, v_transfer_id, -p_amount_ugx, v_service_date, p_transferred_at),
    (v_to.id, v_transfer_id, p_amount_ugx, v_service_date, p_transferred_at);

  if v_fee > 0 then
    insert into public.financial_transactions (
      direction, amount_ugx, transaction_date, source_type, source_id,
      reference, payment_method, created_by
    ) values (
      'money_out', v_fee, v_service_date, 'financial_transfer_fee', v_transfer_id,
      v_transfer_number || ' deposit fee',
      case when v_from.account_type in ('cash', 'mobile_money') then v_from.account_type else 'other' end,
      p_created_by
    ) returning id into v_fee_transaction_id;

    update public.financial_transfers
    set fee_financial_transaction_id = v_fee_transaction_id
    where id = v_transfer_id;
  end if;

  insert into public.staff_activity_log (
    actor_profile_id, actor_email_snapshot, actor_role_snapshot, action,
    entity_type, entity_id, summary, metadata
  ) values (
    v_actor.id, v_actor.email, v_actor.role, 'financial_transfer.recorded',
    'financial_transfer', v_transfer_id::text,
    coalesce(v_actor.email, 'Unknown manager') || ' recorded ' || v_transfer_number || '.',
    jsonb_build_object(
      'transferNumber', v_transfer_number, 'fromAccount', v_from.name,
      'toAccount', v_to.name, 'amountUgx', p_amount_ugx,
      'serviceDate', v_service_date, 'reference', p_external_reference,
      'notes', p_notes, 'idempotencyKey', btrim(p_idempotency_key),
      'feeAmountUgx', v_fee
    )
  );

  return query select v_transfer_id, v_transfer_number, v_fee_transaction_id;
end;
$$;

create or replace function public.get_financial_transfer_summary(
  p_start_date date,
  p_end_date_exclusive date
)
returns table(transfer_count bigint, total_transferred_ugx bigint, cash_to_mobile_money_ugx bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    coalesce(sum(t.amount_ugx), 0)::bigint,
    coalesce(sum(t.amount_ugx) filter (
      where fa.account_type = 'cash' and ta.account_type = 'mobile_money'
    ), 0)::bigint
  from public.financial_transfers t
  join public.financial_accounts fa on fa.id = t.from_account_id
  join public.financial_accounts ta on ta.id = t.to_account_id
  where t.service_date >= p_start_date
    and t.service_date < p_end_date_exclusive
    and t.reversed_at is null;
$$;
create or replace function public.get_daily_cash_reconciliation(
  p_service_date date,
  p_opening_cash_ugx bigint default 0
)
returns table(
  cash_sales_ugx bigint,
  cash_money_out_ugx bigint,
  cash_transfers_out_ugx bigint,
  cash_transfers_in_ugx bigint,
  expected_cash_ugx bigint,
  cash_activity_exists boolean,
  mobile_money_deposit_recorded boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with cash_sales as (
    select coalesce(sum(t.amount), 0)::bigint as amount
    from public.pos_tenders t
    join public.orders o on o.id = t.order_id
    where o.service_date = p_service_date
      and o.order_source = 'pos'
      and o.payment_status = 'paid'
      and o.status <> 'cancelled'
      and t.tender_type = 'cash'
  ),
  cash_out as (
    select coalesce(sum(ft.amount_ugx), 0)::bigint as amount
    from public.financial_transactions ft
    where ft.transaction_date = p_service_date
      and ft.direction = 'money_out'
      and ft.payment_method = 'cash'
      and ft.voided_at is null
  ),
  transfers as (
    select
      coalesce(sum(t.amount_ugx) filter (where fa.account_type = 'cash'), 0)::bigint as cash_out,
      coalesce(sum(t.amount_ugx) filter (where ta.account_type = 'cash'), 0)::bigint as cash_in,
      coalesce(bool_or(fa.account_type = 'cash' and ta.account_type = 'mobile_money'), false) as has_mobile_money_deposit
    from public.financial_transfers t
    join public.financial_accounts fa on fa.id = t.from_account_id
    join public.financial_accounts ta on ta.id = t.to_account_id
    where t.service_date = p_service_date and t.reversed_at is null
  )
  select
    cash_sales.amount,
    cash_out.amount,
    transfers.cash_out,
    transfers.cash_in,
    coalesce(p_opening_cash_ugx, 0) + cash_sales.amount - cash_out.amount - transfers.cash_out + transfers.cash_in,
    (cash_sales.amount <> 0 or cash_out.amount <> 0 or transfers.cash_out <> 0 or transfers.cash_in <> 0),
    transfers.has_mobile_money_deposit
  from cash_sales cross join cash_out cross join transfers;
$$;

create or replace function public.sign_off_daily_close_v2(
  p_service_date date,
  p_opening_cash_ugx bigint,
  p_actual_cash_counted_ugx bigint,
  p_notes text,
  p_closed_by uuid,
  p_snapshot jsonb
)
returns table(snapshot_id uuid, expected_cash_ugx bigint, variance_ugx bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_reconciliation record;
  v_snapshot_id uuid;
  v_variance bigint;
begin
  if p_service_date is null or p_opening_cash_ugx is null or p_opening_cash_ugx < 0
     or p_actual_cash_counted_ugx is null or p_actual_cash_counted_ugx < 0 then
    raise exception 'daily_close_cash_values_invalid';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'daily_close_notes_too_long'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'daily_close_snapshot_invalid'; end if;

  select * into v_actor from public.profiles where id = p_closed_by;
  if not found or v_actor.role not in ('admin', 'manager') then raise exception 'daily_close_actor_not_authorized'; end if;

  select * into v_reconciliation
  from public.get_daily_cash_reconciliation(p_service_date, p_opening_cash_ugx);
  v_variance := p_actual_cash_counted_ugx - v_reconciliation.expected_cash_ugx;

  insert into public.daily_close_snapshots (
    service_date, closed_by_profile_id, closed_by_email_snapshot, closed_by_role_snapshot,
    opening_float_ugx, cash_counted_ugx, expected_pos_cash_ugx, cash_difference_ugx,
    expected_cash_ugx, cash_money_out_ugx, cash_transfers_out_ugx,
    cash_transfers_in_ugx, deposit_expected, mobile_money_deposit_recorded,
    counted_by_profile_id, counted_at, snapshot, notes
  ) values (
    p_service_date, v_actor.id, v_actor.email, v_actor.role,
    p_opening_cash_ugx, p_actual_cash_counted_ugx, v_reconciliation.cash_sales_ugx, v_variance,
    v_reconciliation.expected_cash_ugx, v_reconciliation.cash_money_out_ugx,
    v_reconciliation.cash_transfers_out_ugx, v_reconciliation.cash_transfers_in_ugx,
    v_reconciliation.cash_activity_exists, v_reconciliation.mobile_money_deposit_recorded,
    v_actor.id, now(),
    p_snapshot || jsonb_build_object(
      'cashReconciliation', jsonb_build_object(
        'openingCashUgx', p_opening_cash_ugx,
        'cashSalesUgx', v_reconciliation.cash_sales_ugx,
        'cashMoneyOutUgx', v_reconciliation.cash_money_out_ugx,
        'cashTransfersOutUgx', v_reconciliation.cash_transfers_out_ugx,
        'cashTransfersInUgx', v_reconciliation.cash_transfers_in_ugx,
        'expectedCashUgx', v_reconciliation.expected_cash_ugx,
        'actualCashCountedUgx', p_actual_cash_counted_ugx,
        'varianceUgx', v_variance,
        'mobileMoneyDepositRecorded', v_reconciliation.mobile_money_deposit_recorded
      )
    ),
    nullif(btrim(coalesce(p_notes, '')), '')
  ) returning id into v_snapshot_id;

  insert into public.staff_activity_log (
    actor_profile_id, actor_email_snapshot, actor_role_snapshot, action,
    entity_type, entity_id, summary, metadata
  ) values (
    v_actor.id, v_actor.email, v_actor.role, 'daily_close.signed_off',
    'daily_close_snapshot', v_snapshot_id::text,
    coalesce(v_actor.email, 'Unknown manager') || ' signed off Daily Close for ' || p_service_date::text || '.',
    jsonb_build_object(
      'serviceDate', p_service_date, 'openingCashUgx', p_opening_cash_ugx,
      'actualCashCountedUgx', p_actual_cash_counted_ugx,
      'expectedCashUgx', v_reconciliation.expected_cash_ugx,
      'varianceUgx', v_variance
    )
  );

  return query select v_snapshot_id, v_reconciliation.expected_cash_ugx, v_variance;
end;
$$;

alter table public.financial_accounts enable row level security;
alter table public.financial_transfers enable row level security;
alter table public.financial_account_movements enable row level security;

revoke all on public.financial_accounts, public.financial_transfers, public.financial_account_movements
  from public, anon, authenticated;
grant select on public.financial_accounts, public.financial_transfers, public.financial_account_movements
  to service_role;

revoke all on function public.record_financial_transfer(bigint,bigint,bigint,timestamptz,text,text,bigint,uuid,text)
  from public, anon, authenticated;
revoke all on function public.get_daily_cash_reconciliation(date,bigint)
  from public, anon, authenticated;
revoke all on function public.get_financial_transfer_summary(date,date)
  from public, anon, authenticated;
revoke all on function public.sign_off_daily_close_v2(date,bigint,bigint,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_financial_transfer(bigint,bigint,bigint,timestamptz,text,text,bigint,uuid,text)
  to service_role;
grant execute on function public.get_daily_cash_reconciliation(date,bigint)
  to service_role;
grant execute on function public.get_financial_transfer_summary(date,date)
  to service_role;
grant execute on function public.sign_off_daily_close_v2(date,bigint,bigint,text,uuid,jsonb)
  to service_role;

comment on table public.financial_accounts is
  'Operational locations where business money is held. This is not a chart of accounts.';
comment on table public.financial_transfers is
  'Internal movement of business money. Transfers are neither Money In nor Money Out.';
comment on function public.get_daily_cash_reconciliation(date,bigint) is
  'Expected physical cash: opening cash + canonical POS cash sales - cash Money Out - cash transfers out + cash transfers in.';

commit;
