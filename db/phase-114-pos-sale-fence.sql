-- Prepared only. Manager-authorized terminal fence for ambiguous cloud POS requests.
-- The request row and cancellation evidence commit atomically. Existing sale RPCs
-- already serialize on the unique pos_sale_requests idempotency key.
begin;
create table public.pos_sale_cancellation_fences (
  idempotency_key uuid primary key references public.pos_sale_requests(idempotency_key) on delete restrict,
  cashier_profile_id uuid not null references public.profiles(id),
  request_hash text not null check (length(request_hash)=64 and request_hash ~ '^[0-9a-f]{64}$'),
  manager_profile_id uuid not null references public.profiles(id),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  created_at timestamptz not null default now()
);
alter table public.pos_sale_cancellation_fences enable row level security;
revoke all on public.pos_sale_cancellation_fences from public, anon, authenticated, service_role;
grant select on public.pos_sale_cancellation_fences to service_role;

create function public.pos_sale_fence_immutable() returns trigger language plpgsql as $$
begin raise exception 'pos_sale_fence_immutable'; end; $$;
create trigger pos_sale_fence_immutable before update or delete on public.pos_sale_cancellation_fences
for each row execute function public.pos_sale_fence_immutable();

create function public.fence_pos_sale_request(p_key uuid,p_hash text,p_cashier uuid,p_manager uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.pos_sale_requests%rowtype; f public.pos_sale_cancellation_fences%rowtype; inserted boolean;
begin
 if p_key is null or p_cashier is null or p_manager is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_reason is null or length(btrim(p_reason)) not between 10 and 1000 then
   raise exception 'pos_fence_invalid_request';
 end if;
 if not exists(select 1 from public.profiles where id=p_manager and role in ('admin','manager')) then raise exception 'pos_fence_manager_required'; end if;
 if not exists(select 1 from public.profiles where id=p_cashier) then raise exception 'pos_fence_cashier_unknown'; end if;
 insert into public.pos_sale_requests(idempotency_key,request_hash,cashier_profile_id)
 values(p_key,p_hash,p_cashier) on conflict(idempotency_key) do nothing;
 inserted:=found;
 select * into strict r from public.pos_sale_requests where idempotency_key=p_key for update;
 if r.request_hash<>p_hash or r.cashier_profile_id<>p_cashier then raise exception 'pos_fence_identity_mismatch'; end if;
 if r.order_id is not null then return jsonb_build_object('outcome','committed','orderId',r.order_id); end if;
 if inserted then
   insert into public.pos_sale_cancellation_fences(idempotency_key,cashier_profile_id,request_hash,manager_profile_id,reason)
   values(p_key,p_cashier,p_hash,p_manager,btrim(p_reason));
 else
   select * into f from public.pos_sale_cancellation_fences where idempotency_key=p_key;
   if not found then return jsonb_build_object('outcome','unresolved'); end if;
 end if;
 return jsonb_build_object('outcome','cancelled','idempotencyKey',p_key);
end; $$;
revoke all on function public.pos_sale_fence_immutable() from public,anon,authenticated;
revoke all on function public.fence_pos_sale_request(uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fence_pos_sale_request(uuid,text,uuid,uuid,text) to service_role;
commit;
