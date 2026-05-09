begin;

-- Phase 46: time-axis indexes for analytics and Phase 44 health snapshot.
create index if not exists orders_paid_at_idx
  on public.orders (paid_at)
  where paid_at is not null;

create index if not exists orders_completed_at_payment_status_idx
  on public.orders (completed_at, payment_status)
  where completed_at is not null;

create index if not exists orders_service_date_payment_status_idx
  on public.orders (service_date, payment_status, status);

create index if not exists finished_stock_movements_portion_created_id_idx
  on public.finished_stock_movements (portion_type_id, created_at desc, id desc);

commit;
