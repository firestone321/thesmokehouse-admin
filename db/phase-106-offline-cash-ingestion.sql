-- Phase 3B: additive offline ingestion. Apply only after reviewed staging validation.
begin;
create function public.pos_offline_canonical(p_value jsonb) returns text
language sql immutable set search_path=public as $$
 select case jsonb_typeof(p_value)
 when 'object' then '{'||coalesce((select string_agg(to_jsonb(key)::text||':'||public.pos_offline_canonical(value),',' order by key collate "C") from jsonb_each(p_value)),'')||'}'
 when 'array' then '['||coalesce((select string_agg(public.pos_offline_canonical(value),',' order by ord) from jsonb_array_elements(p_value) with ordinality a(value,ord)),'')||']'
 else p_value::text end;
$$;
create function public.pos_offline_payload_hash(p_value jsonb) returns text
language sql immutable set search_path=public,extensions as $$
 select translate(rtrim(encode(extensions.digest(convert_to(public.pos_offline_canonical(p_value),'UTF8'),'sha256'),'base64'),'='),'+/','-_');
$$;
create table public.pos_offline_ingestions (
 transaction_id uuid primary key, terminal_id uuid not null, epoch uuid not null,
 terminal_sequence bigint not null check(terminal_sequence>0),
 receipt_id text not null unique, payload_hash text not null,
 envelope jsonb not null, signature text not null, grant_evidence jsonb not null,
 captured_at timestamptz not null, service_date date not null,
 ingested_at timestamptz not null default now(), order_id bigint unique references public.orders(id),
 acknowledgement jsonb,
 unique(terminal_id,epoch,terminal_sequence),
 foreign key(terminal_id,epoch) references public.pos_offline_terminals(terminal_id,epoch)
);
create table public.pos_offline_stock_settlements (
 transaction_id uuid not null references public.pos_offline_ingestions(transaction_id),
 allocation_id uuid not null, portion_type_id bigint not null,
 quantity integer not null check(quantity>0), order_id bigint not null references public.orders(id),
 recorded_at timestamptz not null default now(),
 primary key(transaction_id,portion_type_id),
 foreign key(allocation_id,portion_type_id) references public.pos_offline_allocation_resources(allocation_id,portion_type_id)
);
create table public.pos_offline_close_adjustments (
 transaction_id uuid primary key references public.pos_offline_ingestions(transaction_id),
 snapshot_id uuid not null references public.daily_close_snapshots(id),
 order_id bigint not null unique references public.orders(id),
 service_date date not null, cash_amount integer not null check(cash_amount>0),
 captured_at timestamptz not null, recorded_at timestamptz not null default now(),
 state text not null default 'needs_review' check(state='needs_review')
);
create index pos_offline_settlement_resource on public.pos_offline_stock_settlements(allocation_id,portion_type_id);
create function public.pos_offline_immutable_evidence() returns trigger language plpgsql as $$
begin
 if tg_table_name='pos_offline_ingestions' and tg_op='UPDATE' then
   if old.acknowledgement is null then return new; end if;
 end if;
 raise exception 'offline_evidence_is_immutable';
end;
$$;
create trigger pos_offline_ingestions_immutable before update or delete on public.pos_offline_ingestions for each row execute function public.pos_offline_immutable_evidence();
create trigger pos_offline_settlements_immutable before update or delete on public.pos_offline_stock_settlements for each row execute function public.pos_offline_immutable_evidence();
create trigger pos_offline_adjustments_immutable before update or delete on public.pos_offline_close_adjustments for each row execute function public.pos_offline_immutable_evidence();
alter table public.pos_offline_ingestions enable row level security;
alter table public.pos_offline_stock_settlements enable row level security;
alter table public.pos_offline_close_adjustments enable row level security;
revoke all on public.pos_offline_ingestions,public.pos_offline_stock_settlements,public.pos_offline_close_adjustments from public,anon,authenticated,service_role;
grant select on public.pos_offline_ingestions,public.pos_offline_stock_settlements,public.pos_offline_close_adjustments to service_role;

create or replace function public.get_pos_offline_allocation_holds(p_stock_date date)
returns table(portion_type_id bigint, held_quantity bigint)
language sql stable set search_path=public as $$
 select r.portion_type_id, sum(r.quantity_held-coalesce(s.quantity,0))::bigint
 from public.pos_offline_allocation_resources r
 join public.pos_offline_allocations a on a.id=r.allocation_id
 left join (select allocation_id,portion_type_id,sum(quantity) quantity
   from public.pos_offline_stock_settlements group by allocation_id,portion_type_id) s
   on s.allocation_id=r.allocation_id and s.portion_type_id=r.portion_type_id
 where a.service_date=p_stock_date
 group by r.portion_type_id;
$$;
comment on function public.get_pos_offline_allocation_holds(date) is
 'Funded physical units minus immutable validated settlements. Expiry never releases stock. No automatic replenishment.';

create function public.ingest_pos_offline_cash_sale(p_envelope jsonb,p_signature text,p_payload_hash text,p_grant jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
 v_id uuid := (p_envelope->>'transactionId')::uuid;
 v_terminal uuid := (p_envelope->>'terminalId')::uuid;
 v_epoch uuid := (p_envelope->>'epoch')::uuid;
 v_sequence bigint := (p_envelope->>'sequence')::bigint;
 v_captured timestamptz := (p_envelope->>'occurredAt')::timestamptz;
 v_day date := (p_envelope->>'serviceDate')::date;
 v_existing public.pos_offline_ingestions%rowtype;
 v_registration public.pos_offline_terminals%rowtype;
 v_allocation public.pos_offline_allocations%rowtype;
 v_actor public.profiles%rowtype;
 v_order public.orders%rowtype;
 v_item jsonb; v_catalog jsonb; v_resource record;
 v_total bigint:=0; v_remaining bigint; v_receipt text;
 v_reason text; v_snapshot uuid; v_ack jsonb; v_settlement jsonb;
begin
 if p_envelope is null or p_grant is null or p_signature is null or p_signature!~'^[A-Za-z0-9_-]{86}$' or
   not(p_envelope ?& array['version','transactionId','terminalId','epoch','sequence','cashierId','grantId','authorization','allocationId','catalogVersion','occurredAt','serviceDate','amountReceived','changeGiven','items','receipt','inputHash']) or
   not(p_grant ?& array['version','terminalId','epoch','terminalKey','cashierId','grantId','allocationId','catalogVersion','serviceDate','permissions','issuedAt','expiresAt','items','budgets']) or
   jsonb_path_exists(p_envelope,'$.** ? (@ == null)') or jsonb_path_exists(p_grant,'$.** ? (@ == null)') then raise exception 'offline_invalid_envelope'; end if;
 if p_payload_hash is distinct from public.pos_offline_payload_hash(p_envelope) then raise exception 'offline_payload_hash_mismatch'; end if;
 if (p_envelope->>'version')::integer<>1 or v_sequence<1 or v_sequence>9007199254740991 or
    jsonb_typeof(p_envelope->'items')<>'array' or jsonb_array_length(p_envelope->'items') not between 1 and 100 or
    v_captured>now()+interval '30 seconds' or v_day<>(v_captured at time zone 'Africa/Kampala')::date then
   raise exception 'offline_invalid_envelope'; end if;
 v_receipt:='L-'||left(v_terminal::text,8)||'-'||left(v_epoch::text,8)||'-'||lpad(v_sequence::text,greatest(6,length(v_sequence::text)),'0');
 if p_envelope#>>'{receipt,saleId}' is distinct from v_receipt then raise exception 'offline_receipt_identity_mismatch'; end if;
 -- Stable ID serialization followed by terminal/allocation row locks.
 perform pg_advisory_xact_lock(hashtextextended(v_id::text,106));
 select * into v_existing from public.pos_offline_ingestions where transaction_id=v_id;
 if found then
   if v_existing.payload_hash<>p_payload_hash or v_existing.envelope<>p_envelope or v_existing.signature<>p_signature then
     raise exception 'offline_identity_conflict'; end if;
   return v_existing.acknowledgement;
 end if;
 select * into v_registration from public.pos_offline_terminals where terminal_id=v_terminal and epoch=v_epoch for update;
 if not found then raise exception 'offline_terminal_unknown'; end if;
 if p_grant->>'terminalId' is distinct from v_terminal::text or p_grant->>'epoch' is distinct from v_epoch::text or
    p_grant->>'terminalKey' is distinct from v_registration.terminal_key or
    p_grant->>'cashierId' is distinct from p_envelope->>'cashierId' or
    p_grant->>'grantId' is distinct from p_envelope->>'grantId' or
    p_grant->>'allocationId' is distinct from p_envelope->>'allocationId' or
    p_grant->>'catalogVersion' is distinct from p_envelope->>'catalogVersion' or
    p_grant->>'serviceDate' is distinct from v_day::text or
    not (p_grant->'permissions' @> '["cash"]'::jsonb) or
    extract(epoch from v_captured)*1000<(p_grant->>'issuedAt')::bigint or
    extract(epoch from v_captured)*1000>=(p_grant->>'expiresAt')::bigint or
    (p_grant->>'expiresAt')::bigint-(p_grant->>'issuedAt')::bigint not between 1 and 43200000 then
   raise exception 'offline_capture_authorization_invalid'; end if;
 select * into v_allocation from public.pos_offline_allocations where id=(p_envelope->>'allocationId')::uuid for update;
 if not found or v_allocation.terminal_id<>v_terminal or v_allocation.epoch<>v_epoch or
    v_allocation.catalog_version<>(p_envelope->>'catalogVersion')::uuid or
    v_allocation.service_date<>v_day or v_captured>=v_allocation.expires_at or
    v_captured<v_allocation.funded_at-interval '1 second' or
    p_grant->'items'<>v_allocation.items or p_grant->'budgets'<>v_allocation.budgets then
   raise exception 'offline_allocation_mismatch'; end if;
 if (select count(distinct i->>'menuItemId') from jsonb_array_elements(p_envelope->'items') i)<>jsonb_array_length(p_envelope->'items') then raise exception 'offline_duplicate_line'; end if;
 for v_item in select value from jsonb_array_elements(p_envelope->'items') loop
   select value into v_catalog from jsonb_array_elements(v_allocation.items) where value->>'menuItemId'=v_item->>'menuItemId';
   if v_catalog is null or (v_item->>'quantity')::integer not between 1 and 20 or
      v_item->>'name' is distinct from v_catalog->>'name' or
      v_item->'unitPrice' is distinct from v_catalog->'unitPrice' or
      v_item->'requirements' is distinct from v_catalog->'requirements' or
      (v_item->>'total')::bigint<>(v_item->>'quantity')::integer*(v_catalog->>'unitPrice')::bigint then
     raise exception 'offline_historical_item_mismatch'; end if;
   v_total:=v_total+(v_item->>'total')::bigint;
 end loop;
 if v_total not between 1 and 100000000 or (p_envelope#>>'{receipt,total}')::bigint<>v_total or
    (p_envelope#>>'{receipt,subtotal}')::bigint<>v_total or
    (p_envelope->>'amountReceived')::bigint not between v_total and 100000000 or
    (p_envelope->>'changeGiven')::bigint<>(p_envelope->>'amountReceived')::bigint-v_total or
    p_envelope#>>'{receipt,paymentMethod}' is distinct from 'cash' then raise exception 'offline_tender_mismatch'; end if;
 if p_envelope#>>'{receipt,date}' is distinct from p_envelope->>'occurredAt' or
   p_envelope#>'{receipt,items}' is distinct from (select jsonb_agg(jsonb_build_object('name',i->>'name','quantity',(i->>'quantity')::integer,'unitPrice',(i->>'unitPrice')::integer,'total',(i->>'total')::integer) order by ord) from jsonb_array_elements(p_envelope->'items') with ordinality a(i,ord)) or
   p_envelope->>'inputHash' is distinct from public.pos_offline_payload_hash(jsonb_build_object(
     'transactionId',v_id,'catalogVersion',p_envelope->>'catalogVersion','expectedTotal',v_total,'amountReceived',(p_envelope->>'amountReceived')::integer,
     'items',(select jsonb_agg(jsonb_build_object('menuItemId',(i->>'menuItemId')::bigint,'quantity',(i->>'quantity')::integer) order by (i->>'menuItemId')::bigint) from jsonb_array_elements(p_envelope->'items') i))) then
   raise exception 'offline_historical_receipt_mismatch'; end if;
 select * into v_actor from public.profiles where id=(p_envelope->>'cashierId')::uuid;
 if not v_registration.enabled then v_reason:='terminal_authorization_changed';
 elsif v_actor.id is null or v_actor.role not in ('admin','manager','cashier','staff') or
   exists(select 1 from auth.users where id=v_actor.id and banned_until>now()) then v_reason:='cashier_authorization_changed'; end if;
 insert into public.pos_offline_ingestions(transaction_id,terminal_id,epoch,terminal_sequence,receipt_id,payload_hash,envelope,signature,grant_evidence,captured_at,service_date)
 values(v_id,v_terminal,v_epoch,v_sequence,v_receipt,p_payload_hash,p_envelope,p_signature,p_grant,v_captured,v_day);
 if v_reason is not null then
   v_ack:=jsonb_build_object('version',1,'acknowledgementId',v_id,'transactionId',v_id,'terminalId',v_terminal,'epoch',v_epoch,
      'sequence',v_sequence,'payloadHash',p_payload_hash,'committedAt',now(),'disposition','needs_review','reason',v_reason);
   update public.pos_offline_ingestions set acknowledgement=v_ack where transaction_id=v_id;
   return v_ack;
 end if;
 -- Serialize against a close for this day. sign_off_daily_close_v2 uses the same
 -- day lock (wrapper installed below); signed snapshots are never updated.
 perform pg_advisory_xact_lock(hashtextextended('offline-close:'||v_day::text,106));
 select id into v_snapshot from public.daily_close_snapshots where service_date=v_day;
 insert into public.orders(customer_name,notes,status,payment_status,payment_provider,paid_at,service_date,
   promised_at,total_amount,order_source,cashier_profile_id,created_at,completed_at,
   stock_reserved_at,stock_reservation_status,stock_reservation_attempted_at,fulfillment_review_required,fulfillment_review_reason)
 values('Walk-in customer','Offline cash sale '||v_receipt,'ready','paid','pos',v_captured,v_day,
   v_captured,v_total::integer,'pos',v_actor.id,v_captured,v_captured,
   v_captured,'finalized',now(),v_snapshot is not null,case when v_snapshot is not null then 'Late offline cash sale requires signed-close reconciliation.' end)
 returning * into v_order;
 insert into public.order_items(order_id,menu_item_id,menu_item_name,quantity,unit_price,created_at)
 select v_order.id,(i->>'menuItemId')::bigint,i->>'name',(i->>'quantity')::integer,(i->>'unitPrice')::integer,v_captured
 from jsonb_array_elements(p_envelope->'items') i;
 for v_resource in
   select (r->>'resourceId')::bigint id,sum((i->>'quantity')::integer*(r->>'quantity')::integer)::integer quantity
   from jsonb_array_elements(p_envelope->'items') i, lateral jsonb_array_elements(i->'requirements') r
   group by (r->>'resourceId')::bigint order by (r->>'resourceId')::bigint
 loop
   select r.quantity_held-coalesce((select sum(s.quantity) from public.pos_offline_stock_settlements s
       where s.allocation_id=r.allocation_id and s.portion_type_id=r.portion_type_id),0) into v_remaining
   from public.pos_offline_allocation_resources r where r.allocation_id=v_allocation.id and r.portion_type_id=v_resource.id for update;
   if not found or v_remaining<v_resource.quantity then raise exception 'offline_allocation_overconsumed'; end if;
   -- Funding already reduced finished stock. Only move the daily reservation bucket.
   update public.daily_stock set reserved_quantity=reserved_quantity-v_resource.quantity,
     sold_quantity=sold_quantity+v_resource.quantity
   where stock_date=v_day and portion_type_id=v_resource.id and reserved_quantity>=v_resource.quantity;
   if not found then raise exception 'offline_daily_hold_missing'; end if;
   insert into public.pos_offline_stock_settlements(transaction_id,allocation_id,portion_type_id,quantity,order_id)
   values(v_id,v_allocation.id,v_resource.id,v_resource.quantity,v_order.id);
 end loop;
 insert into public.pos_tenders(order_id,tender_type,amount,amount_received,captured_by_profile_id,captured_at,created_at)
 values(v_order.id,'cash',v_total::integer,(p_envelope->>'amountReceived')::integer,v_actor.id,v_captured,v_captured);
 insert into public.order_status_events(order_id,event_type,from_status,to_status,note)
 values(v_order.id,'status_changed','new','ready','Imported committed offline cash sale; no hardware replay.');
 insert into public.staff_activity_log(actor_profile_id,actor_email_snapshot,actor_role_snapshot,action,entity_type,entity_id,order_id,summary,metadata)
 values(v_actor.id,v_actor.email,v_actor.role,'pos.offline_sale_ingested','order',v_order.id::text,v_order.id,
   'Offline cash sale synchronized.',jsonb_build_object('transaction_id',v_id,'terminal_id',v_terminal,'epoch',v_epoch,'sequence',v_sequence,'captured_at',v_captured,'payload_hash',p_payload_hash));
 if v_snapshot is not null then
   insert into public.pos_offline_close_adjustments(transaction_id,snapshot_id,order_id,service_date,cash_amount,captured_at)
   values(v_id,v_snapshot,v_order.id,v_day,v_total::integer,v_captured);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('resourceId',portion_type_id,'quantity',quantity) order by portion_type_id),'[]') into v_settlement
 from public.pos_offline_stock_settlements where transaction_id=v_id;
 v_ack:=jsonb_build_object('version',1,'acknowledgementId',v_id,'transactionId',v_id,'terminalId',v_terminal,'epoch',v_epoch,
   'sequence',v_sequence,'orderId',v_order.id,'orderNumber',v_order.order_number,'payloadHash',p_payload_hash,
   'committedAt',now(),'disposition',case when v_snapshot is null then 'acknowledged' else 'needs_review' end,
   'reason',case when v_snapshot is not null then 'signed_close_adjustment_required' end,'settlement',v_settlement);
 update public.pos_offline_ingestions set order_id=v_order.id,acknowledgement=v_ack where transaction_id=v_id;
 return v_ack;
end;
$$;
revoke all on function public.ingest_pos_offline_cash_sale(jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_pos_offline_cash_sale(jsonb,text,text,jsonb) to service_role;
revoke all on function public.pos_offline_canonical(jsonb),public.pos_offline_payload_hash(jsonb),public.pos_offline_immutable_evidence() from public,anon,authenticated;
grant execute on function public.pos_offline_canonical(jsonb),public.pos_offline_payload_hash(jsonb) to service_role;
commit;
