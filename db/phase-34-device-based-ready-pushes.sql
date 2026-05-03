begin;

-- Phase 34: make customer Ready push routing device-based instead of order-linked.
-- Purpose:
-- 1. Persist the customer device identifier on the order itself.
-- 2. Let storefront push delivery resolve Ready recipients from the order's device.
-- 3. Clear the old order-linked subscription rows so the rollout starts cleanly.

delete from public.push_subscription_orders;

alter table public.orders
  add column if not exists device_id text;

create index if not exists orders_device_id_idx
  on public.orders (device_id)
  where device_id is not null;

comment on column public.orders.device_id is
  'Customer device/browser identifier used to route Ready push notifications to the device that placed the order.';

commit;
