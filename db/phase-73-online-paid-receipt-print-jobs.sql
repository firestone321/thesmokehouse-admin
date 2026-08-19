-- Phase 73: durable, idempotent receipt-print jobs for paid storefront orders.
-- Apply after Phase 72. The job snapshot is created in the paid transition so
-- a later menu/order edit cannot alter the receipt that was authorized to print.

begin;

alter table public.admin_push_subscriptions
  add column if not exists is_pos_print_station boolean not null default false;

create unique index if not exists admin_push_subscriptions_one_pos_print_station_idx
  on public.admin_push_subscriptions ((is_pos_print_station))
  where is_pos_print_station;

create table if not exists public.online_receipt_print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null unique references public.orders(id) on update cascade on delete cascade,
  receipt jsonb not null,
  status text not null default 'pending',
  last_attempt_at timestamptz,
  completed_at timestamptz,
  last_error text,
  bridge_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint online_receipt_print_jobs_status_chk check (status in ('pending', 'accepted')),
  constraint online_receipt_print_jobs_receipt_object_chk check (jsonb_typeof(receipt) = 'object')
);

create index if not exists online_receipt_print_jobs_pending_idx
  on public.online_receipt_print_jobs (status, created_at);

drop trigger if exists online_receipt_print_jobs_set_updated_at on public.online_receipt_print_jobs;
create trigger online_receipt_print_jobs_set_updated_at
before update on public.online_receipt_print_jobs
for each row execute function public.set_updated_at();

alter table public.online_receipt_print_jobs enable row level security;
grant all on public.online_receipt_print_jobs to service_role;

create or replace function public.enqueue_online_paid_receipt_print_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_payment_status text := '';
begin
  if tg_op = 'UPDATE' then
    previous_payment_status := lower(trim(coalesce(old.payment_status, '')));
  end if;

  if lower(trim(coalesce(new.payment_status, ''))) = 'paid'
    and previous_payment_status <> 'paid'
    and coalesce(new.order_source, 'storefront') <> 'pos' then
    insert into public.online_receipt_print_jobs (order_id, receipt)
    select
      new.id,
      jsonb_build_object(
        'saleId', coalesce(nullif(btrim(new.order_number), ''), new.id::text),
        'date', coalesce(new.paid_at, now())::text,
        'items', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'name', item.menu_item_name,
                'quantity', item.quantity,
                'unitPrice', item.unit_price,
                'total', item.line_total
              )
              order by item.id
            )
            from public.order_items as item
            where item.order_id = new.id
          ),
          '[]'::jsonb
        ),
        'subtotal', new.total_amount,
        'total', new.total_amount,
        'paymentMethod', 'other'
      )
    on conflict (order_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_enqueue_online_paid_receipt_print_job on public.orders;
create trigger orders_enqueue_online_paid_receipt_print_job
after insert or update of payment_status on public.orders
for each row execute function public.enqueue_online_paid_receipt_print_job();

comment on table public.online_receipt_print_jobs is
  'One canonical receipt snapshot per paid storefront order. The PWA receives the job ID, requests a short-lived job-bound JWT, and reports the local bridge result.';

commit;
