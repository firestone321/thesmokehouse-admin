-- Phase 80: ISO 8601 timestamps for bridge-authorized online receipt jobs.
-- Phase 73 used timestamptz::text, which PostgreSQL renders with a space
-- between date and time. The local bridge correctly requires ISO 8601.

begin;

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
        'date', to_char(coalesce(new.paid_at, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
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

-- Explicit historical repair approved for the two known pending jobs only.
-- Preserve each immutable receipt's item and amount snapshot; replace only
-- its invalid timestamp and clear the failed bridge-attempt metadata.
update public.online_receipt_print_jobs as job
set
  receipt = jsonb_set(
    job.receipt,
    '{date}',
    to_jsonb(to_char(coalesce(orders.paid_at, job.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    true
  ),
  status = 'pending',
  completed_at = null,
  last_attempt_at = null,
  last_error = null,
  bridge_result = null
from public.orders
where job.order_id = orders.id
  and job.order_id in (39, 40)
  and job.status = 'pending';

commit;
