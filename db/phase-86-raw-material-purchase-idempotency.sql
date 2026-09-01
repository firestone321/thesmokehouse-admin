begin;

-- Phase 82 may have created raw_material_purchases before the idempotency
-- column was introduced. Add it safely without changing purchase history.
alter table public.raw_material_purchases
  add column if not exists idempotency_key text;

-- Existing purchases need stable unique keys before the column becomes
-- required. Future purchases continue to receive their keys from the RPC.
update public.raw_material_purchases
set idempotency_key = 'raw-material-purchase:' || id::text
where idempotency_key is null or btrim(idempotency_key) = '';

alter table public.raw_material_purchases
  alter column idempotency_key set not null;

create unique index if not exists raw_material_purchases_idempotency_key_uidx
  on public.raw_material_purchases (idempotency_key);

commit;
