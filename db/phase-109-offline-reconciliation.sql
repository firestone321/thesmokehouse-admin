begin;

alter function public.ingest_pos_offline_cash_sale(jsonb,text,text,jsonb) rename to ingest_pos_offline_cash_sale_v106;
revoke all on function public.ingest_pos_offline_cash_sale_v106(jsonb,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.ingest_pos_offline_cash_sale(p_envelope jsonb,p_signature text,p_payload_hash text,p_grant jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
 perform 1 from public.pos_offline_terminals where terminal_id=(p_envelope->>'terminalId')::uuid and epoch=(p_envelope->>'epoch')::uuid for update;
 if not exists(select 1 from public.pos_offline_ingestions where transaction_id=(p_envelope->>'transactionId')::uuid)
 and exists(select 1 from public.pos_offline_closures where allocation_id=(p_envelope->>'allocationId')::uuid) then raise exception 'offline_allocation_closed';end if;
 return public.ingest_pos_offline_cash_sale_v106(p_envelope,p_signature,p_payload_hash,p_grant);end;$$;
alter function public.get_pos_offline_snapshot(uuid,uuid,text,uuid) rename to get_pos_offline_snapshot_v103;
revoke all on function public.get_pos_offline_snapshot_v103(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.get_pos_offline_snapshot(p_terminal_id uuid,p_epoch uuid,p_terminal_key text,p_cashier_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
 if exists(select 1 from public.pos_offline_controls where terminal_id=p_terminal_id and epoch=p_epoch and (suspended or revoked)) then raise exception 'offline_terminal_suspended';end if;
 return public.get_pos_offline_snapshot_v103(p_terminal_id,p_epoch,p_terminal_key,p_cashier_id);end;$$;
create or replace function public.get_pos_offline_allocation_holds(p_stock_date date)
returns table(portion_type_id bigint,held_quantity bigint) language sql stable set search_path=public as $$
 select r.portion_type_id,sum(r.quantity_held-coalesce(s.quantity,0)-coalesce(t.quantity,0))::bigint
 from public.pos_offline_allocation_resources r join public.pos_offline_allocations a on a.id=r.allocation_id
 left join(select allocation_id,portion_type_id,sum(quantity) quantity from public.pos_offline_stock_settlements group by allocation_id,portion_type_id)s using(allocation_id,portion_type_id)
 left join(select allocation_id,portion_type_id,sum(quantity) quantity from public.pos_offline_stock_returns group by allocation_id,portion_type_id)t using(allocation_id,portion_type_id)
 where a.service_date=p_stock_date group by r.portion_type_id;$$;
create function public.post_approved_pos_offline_evidence(p_transaction_id uuid,p_manager_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
 p_envelope jsonb := (select envelope from public.pos_offline_ingestions where transaction_id=p_transaction_id);
 p_signature text := (select signature from public.pos_offline_ingestions where transaction_id=p_transaction_id);
 p_payload_hash text := (select payload_hash from public.pos_offline_ingestions where transaction_id=p_transaction_id);
 p_grant jsonb := (select grant_evidence from public.pos_offline_ingestions where transaction_id=p_transaction_id);
 v_prior jsonb;
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
 perform public.assert_pos_offline_manager(p_manager_id,p_reason);
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
 select acknowledgement into v_prior from public.pos_offline_approved_postings where transaction_id=v_id;
 if found then return v_prior;end if;
 select * into v_existing from public.pos_offline_ingestions where transaction_id=v_id;
 if v_existing.order_id is not null then return v_existing.acknowledgement;end if;
 if exists(select 1 from public.pos_offline_decisions where transaction_id=v_id and action='confirmed_duplicate') then raise exception 'offline_duplicate_resolution_is_final_use_additive_review';end if;
 if v_existing.acknowledgement->>'reason' not in ('cashier_authorization_changed','terminal_authorization_changed') then raise exception 'offline_original_evidence_not_eligible';end if;
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
 if not found then raise exception 'offline_original_cashier_record_missing';end if;
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
   select r.quantity_held-coalesce((select sum(t.quantity) from public.pos_offline_stock_returns t where t.allocation_id=r.allocation_id and t.portion_type_id=r.portion_type_id),0)-coalesce((select sum(s.quantity) from public.pos_offline_stock_settlements s
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
 insert into public.pos_offline_approved_postings values(v_id,v_order.id,v_ack,p_manager_id,p_reason,now());
 return v_ack;
end;
$$;

create function public.decide_pos_offline_record(p_decision uuid,p_transaction uuid,p_manager uuid,p_action text,p_reason text,p_reference_order bigint default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i public.pos_offline_ingestions%rowtype;v_close public.pos_offline_close_adjustments%rowtype;r jsonb;v_order bigint;
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_transaction::text,106));
 if exists(select 1 from public.pos_offline_decisions where id=p_decision) then
 select result into r from public.pos_offline_decisions where id=p_decision and transaction_id=p_transaction and reviewer_id=p_manager and action=p_action and reason=p_reason;
 if r is null or (p_action='confirmed_duplicate' and (r->>'orderId')::bigint is distinct from p_reference_order) then raise exception 'offline_decision_identity_conflict';end if;return r;end if;
 select * into i from public.pos_offline_ingestions where transaction_id=p_transaction;
 if not found then raise exception 'offline_signed_ingestion_evidence_required';end if;
 select coalesce(i.order_id,(select order_id from public.pos_offline_approved_postings where transaction_id=i.transaction_id)) into v_order;
 if p_action='confirm_genuine' then r:=public.post_approved_pos_offline_evidence(p_transaction,p_manager,p_reason);
 elsif p_action='resolve_late' then
 select * into v_close from public.pos_offline_close_adjustments where transaction_id=p_transaction;
 if not found then raise exception 'offline_late_adjustment_required';end if;
 r:=jsonb_build_object('action','resolved_late','orderId',v_close.order_id,'snapshotId',v_close.snapshot_id,'additiveCashAdjustment',v_close.cash_amount,'noAdditionalTender',true);
 elsif p_action='confirmed_duplicate' then
 if v_order is not null or p_reference_order is null or not exists(select 1 from public.orders o where o.id=p_reference_order and o.payment_status='paid' and o.order_source='pos' and o.service_date=i.service_date and o.cashier_profile_id::text=i.envelope->>'cashierId' and o.total_amount=(i.envelope#>>'{receipt,total}')::integer)
 then raise exception 'offline_matching_existing_canonical_sale_required';end if;
 r:=jsonb_build_object('action','confirmed_duplicate','orderId',p_reference_order,'noNewFinancialPosting',true,'allocationReviewRequired',true);
 elsif p_action in ('review_evidence','flag_duplicate','handover_review') then r:=jsonb_build_object('action',p_action,'noFinancialEffects',true);
 elsif p_action='close_incident' then
 if not exists(select 1 from public.pos_offline_decisions where transaction_id=p_transaction and action in ('confirm_genuine','confirmed_duplicate','resolve_late')) then raise exception 'offline_explicit_accounting_resolution_required';end if;
 if exists(select 1 from public.pos_offline_close_adjustments a where a.transaction_id=p_transaction and not exists(select 1 from public.pos_offline_close_resolutions s where s.transaction_id=a.transaction_id)) then raise exception 'offline_late_review_required';end if;
 r:=jsonb_build_object('action','closed_incident','orderId',v_order);
 else raise exception 'offline_invalid_decision';end if;
 insert into public.pos_offline_decisions values(p_decision,p_transaction,i.terminal_id,i.epoch,p_action,p_manager,p_reason,r,now());
 if p_action='resolve_late' then
 insert into public.pos_offline_close_resolutions values(p_transaction,p_decision,v_close.snapshot_id,v_close.order_id,v_close.service_date,v_close.cash_amount,p_manager,p_reason,now());end if;
 return r;end;$$;
create or replace function public.get_business_truth_health_snapshot(
  p_now timestamptz default now(),
  p_service_date date default current_date
)
returns table (
  generated_at timestamptz,
  critical_count integer,
  warning_count integer,
  sections jsonb
)
language sql
stable
as $$
  with
  paid_missing_stock as (
    select
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.stock_reservation_status,
      o.stock_reservation_error,
      o.created_at
    from public.orders o
    where o.payment_status = 'paid'
      and o.status <> 'cancelled'
      and o.stock_reserved_at is null
      and coalesce(o.stock_reservation_status, 'not_started') not in ('reserved', 'finalized')
    order by o.created_at desc
  ),
  unpaid_in_kitchen as (
    select
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.created_at
    from public.orders o
    where coalesce(o.payment_status, 'pending') <> 'paid'
      and o.status in ('confirmed', 'in_prep', 'ready', 'completed')
    order by o.created_at desc
  ),
  paid_not_in_flow as (
    select
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.fulfillment_review_required,
      o.fulfillment_review_reason,
      o.created_at
    from public.orders o
    where o.payment_status = 'paid'
      and o.status in ('new', 'cancelled')
      and coalesce(o.fulfillment_review_required, false) = false
    order by o.created_at desc
  ),
  cancelled_provider_paid as (
    select distinct
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      pa.provider,
      pa.provider_reference,
      pa.verified_at,
      o.created_at
    from public.orders o
    join public.payment_attempts pa
      on pa.order_id = o.id
    where (o.status = 'cancelled' or o.payment_status = 'cancelled')
      and pa.payment_status = 'paid'
    order by o.created_at desc
  ),
  stale_payment_recoveries as (
    select
      r.id,
      r.order_id,
      o.order_number,
      r.status,
      r.attempt_count,
      r.next_attempt_at,
      r.locked_at,
      r.last_error
    from public.pending_payment_recoveries r
    left join public.orders o
      on o.id = r.order_id
    where r.completed_at is null
      and (
        r.next_attempt_at <= p_now - interval '5 minutes'
        or r.locked_at <= p_now - interval '5 minutes'
        or r.status = 'failed'
      )
    order by coalesce(r.next_attempt_at, r.created_at) asc
  ),
  latest_finished_movements as (
    select distinct on (fsm.portion_type_id)
      fsm.portion_type_id,
      fsm.resulting_quantity,
      fsm.created_at
    from public.finished_stock_movements fsm
    order by fsm.portion_type_id, fsm.created_at desc, fsm.id desc
  ),
  finished_stock_drift as (
    select
      fs.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      fs.current_quantity,
      lfm.resulting_quantity as movement_quantity,
      lfm.created_at as last_movement_at
    from public.finished_stock fs
    join public.portion_types pt
      on pt.id = fs.portion_type_id
    left join latest_finished_movements lfm
      on lfm.portion_type_id = fs.portion_type_id
    where lfm.portion_type_id is not null
      and fs.current_quantity <> lfm.resulting_quantity
    order by abs(fs.current_quantity - lfm.resulting_quantity) desc, pt.sort_order, pt.id
  ),
  paid_stock_lines as (
    select coalesce(pt.stock_source_portion_type_id,mi.portion_type_id) portion_type_id,
      oi.quantity*coalesce(pt.stock_source_units_per_serving,1) quantity,o.payment_status,o.status,o.stock_reservation_status
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.menu_items mi on mi.id=oi.menu_item_id join public.portion_types pt on pt.id=mi.portion_type_id
    where o.service_date=p_service_date and not exists(select 1 from public.pos_offline_ingestions i where i.order_id=o.id) and not exists(select 1 from public.pos_offline_approved_postings ap where ap.order_id=o.id)
    union all
    select s.portion_type_id,s.quantity,o.payment_status,o.status,o.stock_reservation_status
    from public.pos_offline_stock_settlements s join public.orders o on o.id=s.order_id where o.service_date=p_service_date
  ),
  daily_paid_totals as (
    select portion_type_id,sum(case when payment_status='paid' and status<>'cancelled' and stock_reservation_status='reserved' then quantity else 0 end)::integer expected_reserved_quantity,
    sum(case when payment_status='paid' and status<>'cancelled' and stock_reservation_status='finalized' then quantity else 0 end)::integer expected_sold_quantity
    from paid_stock_lines group by portion_type_id
  ),
  offline_holds as (
    select * from public.get_pos_offline_allocation_holds(p_service_date)
  ),
  daily_stock_drift as (
    select
      ds.stock_date,
      ds.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      ds.reserved_quantity,
      coalesce(dpt.expected_reserved_quantity, 0) as expected_paid_reserved_quantity,
      coalesce(oh.held_quantity, 0) as offline_allocation_held_quantity,
      coalesce(dpt.expected_reserved_quantity, 0) + coalesce(oh.held_quantity, 0) as expected_reserved_quantity,
      ds.sold_quantity,
      coalesce(dpt.expected_sold_quantity, 0) as expected_sold_quantity
    from public.daily_stock ds
    join public.portion_types pt
      on pt.id = ds.portion_type_id
    left join daily_paid_totals dpt
      on dpt.portion_type_id = ds.portion_type_id
    left join offline_holds oh on oh.portion_type_id = ds.portion_type_id
    where ds.stock_date = p_service_date
      and (
        ds.reserved_quantity <> coalesce(dpt.expected_reserved_quantity, 0) + coalesce(oh.held_quantity, 0)
        or ds.sold_quantity <> coalesce(dpt.expected_sold_quantity, 0)
      )
    order by pt.sort_order, pt.id
  ),
  negative_or_zero_truth as (
    select
      fs.portion_type_id,
      pt.code as portion_code,
      pt.name as portion_name,
      pt.portion_label,
      fs.current_quantity
    from public.finished_stock fs
    join public.portion_types pt
      on pt.id = fs.portion_type_id
    where fs.current_quantity < 0
    order by fs.current_quantity asc, pt.sort_order, pt.id
  ),
  counts as (
    select
      (select count(*) from paid_missing_stock) as paid_missing_stock_count,
      (select count(*) from unpaid_in_kitchen) as unpaid_in_kitchen_count,
      (select count(*) from paid_not_in_flow) as paid_not_in_flow_count,
      (select count(*) from cancelled_provider_paid) as cancelled_provider_paid_count,
      (select count(*) from stale_payment_recoveries) as stale_payment_recoveries_count,
      (select count(*) from finished_stock_drift) as finished_stock_drift_count,
      (select count(*) from daily_stock_drift) as daily_stock_drift_count,
      (select count(*) from negative_or_zero_truth) as negative_stock_count
  )
  select
    p_now as generated_at,
    (
      c.paid_missing_stock_count
      + c.unpaid_in_kitchen_count
      + c.paid_not_in_flow_count
      + c.cancelled_provider_paid_count
      + c.finished_stock_drift_count
      + c.daily_stock_drift_count
      + c.negative_stock_count
    )::integer as critical_count,
    c.stale_payment_recoveries_count::integer as warning_count,
    jsonb_build_array(
      jsonb_build_object(
        'key', 'paid_missing_stock',
        'title', 'Paid orders missing stock reservation',
        'severity', 'critical',
        'count', c.paid_missing_stock_count,
        'description', 'Paid orders that have not reserved/finalized stock.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from paid_missing_stock limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'unpaid_in_kitchen',
        'title', 'Unpaid orders in kitchen flow',
        'severity', 'critical',
        'count', c.unpaid_in_kitchen_count,
        'description', 'Orders not marked paid but already confirmed, in prep, ready, or completed.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from unpaid_in_kitchen limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'paid_not_in_flow',
        'title', 'Paid orders outside staff flow',
        'severity', 'critical',
        'count', c.paid_not_in_flow_count,
        'description', 'Paid orders still new/cancelled without fulfillment review.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from paid_not_in_flow limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'cancelled_provider_paid',
        'title', 'Cancelled local orders with paid provider attempt',
        'severity', 'critical',
        'count', c.cancelled_provider_paid_count,
        'description', 'Local cancellation conflicts with provider-paid evidence.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from cancelled_provider_paid limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'finished_stock_drift',
        'title', 'Finished stock differs from latest movement',
        'severity', 'critical',
        'count', c.finished_stock_drift_count,
        'description', 'Durable stock balance does not match the latest movement result.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from finished_stock_drift limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'daily_stock_drift',
        'title', 'Daily stock differs from paid order totals',
        'severity', 'critical',
        'count', c.daily_stock_drift_count,
        'description', 'Service-day reserved/sold counts differ from paid orders plus separately funded offline holds.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from daily_stock_drift limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'negative_stock',
        'title', 'Negative finished stock',
        'severity', 'critical',
        'count', c.negative_stock_count,
        'description', 'Finished stock quantity is below zero.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from negative_or_zero_truth limit 10) row), '[]'::jsonb)
      ),
      jsonb_build_object(
        'key', 'stale_payment_recoveries',
        'title', 'Stale pending payment recoveries',
        'severity', 'warning',
        'count', c.stale_payment_recoveries_count,
        'description', 'Recovery rows are due, stalled, or failed.',
        'items', coalesce((select jsonb_agg(to_jsonb(row)) from (select * from stale_payment_recoveries limit 10) row), '[]'::jsonb)
      )
    ) as sections
  from counts c;
$$;

revoke execute on function public.get_business_truth_health_snapshot(timestamptz, date)
from public, anon, authenticated;
grant execute on function public.get_business_truth_health_snapshot(timestamptz, date)
to service_role;

comment on function public.get_business_truth_health_snapshot(timestamptz, date) is
  'Returns read-only payment/stock/recovery reconciliation counts and previews; Phase 79 classifies reserved versus sold orders by stock reservation state.';




create or replace function public.guard_ingested_offline_order() returns trigger language plpgsql security definer set search_path=public as $$
declare v_order_id bigint;
begin
 if tg_table_name='orders' then
   v_order_id:=old.id;
   if exists(select 1 from public.pos_offline_ingestions where order_id=v_order_id and acknowledgement is not null union all select 1 from public.pos_offline_approved_postings where order_id=v_order_id) and
     ((to_jsonb(new)-'updated_at'-'fulfillment_review_required'-'fulfillment_review_reason') is distinct from (to_jsonb(old)-'updated_at'-'fulfillment_review_required'-'fulfillment_review_reason') or
      (new.fulfillment_review_required is not distinct from old.fulfillment_review_required and new.fulfillment_review_reason is not distinct from old.fulfillment_review_reason)) then
     raise exception 'ingested_offline_order_is_immutable'; end if;
   return new;
 end if;
 if tg_op='INSERT' then v_order_id:=new.order_id; else v_order_id:=old.order_id; end if;
 if exists(select 1 from public.pos_offline_ingestions where order_id=v_order_id and acknowledgement is not null union all select 1 from public.pos_offline_approved_postings where order_id=v_order_id) then
   raise exception 'ingested_offline_order_is_immutable'; end if;
 if tg_op='UPDATE' and exists(select 1 from public.pos_offline_ingestions where order_id=new.order_id and acknowledgement is not null union all select 1 from public.pos_offline_approved_postings where order_id=new.order_id) then
   raise exception 'ingested_offline_order_is_immutable'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end; $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('post_approved_pos_offline_evidence','decide_pos_offline_record','ingest_pos_offline_cash_sale','get_pos_offline_snapshot') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end;$$;
commit;
