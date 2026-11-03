-- Phase 113: development-only forward migration. Original 103–112 remain unchanged.
begin;
create table public.pos_offline_allocation_targets(
 allocation_id uuid not null references public.pos_offline_allocations(id),portion_type_id bigint not null,
 initial_quantity integer not null check(initial_quantity>0),target_quantity integer not null check(target_quantity=initial_quantity),
 primary key(allocation_id,portion_type_id),foreign key(allocation_id,portion_type_id) references public.pos_offline_allocation_resources);
insert into public.pos_offline_allocation_targets select allocation_id,portion_type_id,quantity_held,quantity_held from public.pos_offline_allocation_resources;
create table public.pos_offline_replenishment_policies(
 id uuid primary key,allocation_id uuid not null references public.pos_offline_allocations(id),revision bigint not null check(revision>0),
 enabled boolean not null,limits jsonb not null,manager_id uuid not null references public.profiles(id),reason text not null,
 created_at timestamptz not null default now(),unique(allocation_id,revision));
create table public.pos_offline_replenishments(
 id uuid primary key,allocation_id uuid not null references public.pos_offline_allocations(id),revision bigint,
 policy_id uuid references public.pos_offline_replenishment_policies(id),receipt jsonb not null,
 manager_id uuid references public.profiles(id),created_at timestamptz not null default now(),
 unique(allocation_id,revision));
create table public.pos_offline_replenishment_acks(
 id uuid primary key references public.pos_offline_replenishments(id),body jsonb not null,signature text not null,
 activation jsonb not null,created_at timestamptz not null default now());
do $$ declare t text;begin
 foreach t in array array['pos_offline_allocation_targets','pos_offline_replenishment_policies','pos_offline_replenishments','pos_offline_replenishment_acks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to service_role',t);
 execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.pos_offline_immutable_evidence()',t);
 end loop;end;$$;

create or replace function public.fund_pos_offline_allocation(
 p_allocation_id uuid,p_terminal_id uuid,p_epoch uuid,p_catalog_version uuid,
 p_menu_item_ids bigint[],p_budgets jsonb,p_expires_at timestamptz,p_manager_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_today date := (now() at time zone 'Africa/Kampala')::date;
 v_items jsonb; v_budgets jsonb := '[]'::jsonb; v_requested jsonb; v_resource record;
 v_available integer; v_minimum integer; v_quantity integer;
 v_finished public.finished_stock%rowtype; v_daily public.daily_stock%rowtype;
begin
 perform public.assert_pos_offline_manager(p_manager_id,'Approve initial sixty-five percent allocation');
 perform 1 from public.pos_offline_terminals where terminal_id=p_terminal_id and epoch=p_epoch and enabled for update;
 if not found then raise exception 'terminal_not_registered'; end if;
 if exists(select 1 from public.pos_offline_controls where terminal_id=p_terminal_id and epoch=p_epoch and (suspended or revoked)) then raise exception 'offline_terminal_suspended';end if;
 if exists(select 1 from public.pos_offline_allocations where terminal_id=p_terminal_id and state='funded') then raise exception 'reconcile_existing_allocation'; end if;
 if exists(select 1 from public.pos_offline_allocations where terminal_id=p_terminal_id and service_date=v_today) then raise exception 'offline_use_replenishment_for_same_day_target';end if;
 if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '12 hours' or
    (p_expires_at at time zone 'Africa/Kampala')::date<>v_today then raise exception 'invalid_allocation_expiry'; end if;
 if p_menu_item_ids is null or cardinality(p_menu_item_ids) not between 1 and 100 or
    cardinality(p_menu_item_ids)<>(select count(distinct x) from unnest(p_menu_item_ids) x) then raise exception 'invalid_catalog'; end if;
 -- Freeze current prices and recipe/source mappings. Traveller side effects need Phase 3B support.
 select jsonb_agg(jsonb_build_object('menuItemId',m.id,'name',m.name,'unitPrice',m.base_price,
   'requirements',(
     select jsonb_agg(jsonb_build_object('resourceId',r.resource_id,'quantity',r.quantity) order by r.resource_id)
     from (
       select coalesce(req.portion_type_id,p.stock_source_portion_type_id,m.portion_type_id) resource_id,
         sum(coalesce(req.units_per_menu_item,p.stock_source_units_per_serving,1))::integer quantity
       from public.portion_types p left join public.menu_item_stock_requirements req on req.menu_item_id=m.id
       where p.id=m.portion_type_id
       group by coalesce(req.portion_type_id,p.stock_source_portion_type_id,m.portion_type_id)
     ) r
   )) order by m.id) into v_items
 from public.menu_items m where m.id=any(p_menu_item_ids) and m.is_active and m.is_available_today
   and m.base_price between 1 and 100000000 and m.portion_type_id is not null and coalesce(m.code,'') not in
   ('traveller_chicken_meal','traveller_goat_meal','traveller_beef_kebabs','traveller_beef_samosas');
 if v_items is null or jsonb_array_length(v_items)<>cardinality(p_menu_item_ids) then raise exception 'unsupported_catalog_item'; end if;
 v_requested:=p_budgets;
 if v_requested is null then
   select jsonb_agg(jsonb_build_object('resourceId',resource_id) order by resource_id) into v_requested
   from(select distinct (r->>'resourceId')::bigint resource_id from jsonb_array_elements(v_items) i,
     lateral jsonb_array_elements(i->'requirements') r) resources;
 end if;
 if v_requested is null or jsonb_typeof(v_requested)<>'array' or jsonb_array_length(v_requested) not between 1 and 100 then raise exception 'invalid_budget'; end if;
 if exists(select 1 from jsonb_array_elements(v_requested) b where
    coalesce(jsonb_typeof(b->'resourceId'),'null')<>'number' or (b->>'resourceId')!~'^[1-9][0-9]*$' or
    (b ? 'quantity' and (coalesce(jsonb_typeof(b->'quantity'),'null')<>'number' or
     (b->>'quantity')!~'^[1-9][0-9]*$' or (b->>'quantity')::bigint>100000000))) or
    (select count(distinct (b->>'resourceId')::bigint) from jsonb_array_elements(v_requested) b)<>jsonb_array_length(v_requested)
 then raise exception 'invalid_budget'; end if;
 -- Lock all resources before determining the 65% minimum; existing online holds are excluded.
 for v_resource in select (b->>'resourceId')::bigint id,(b->>'quantity')::integer requested
   from jsonb_array_elements(v_requested) b order by (b->>'resourceId')::bigint loop
   select * into v_finished from public.finished_stock where portion_type_id=v_resource.id for update;
   if not found or v_finished.current_quantity<=0 then raise exception 'insufficient_finished_stock'; end if;
   v_available:=v_finished.current_quantity;
   select * into v_daily from public.daily_stock where stock_date=v_today and portion_type_id=v_resource.id for update;
   if found then v_available:=least(v_available,v_daily.remaining_quantity); end if;
   if v_available<=0 then raise exception 'insufficient_daily_stock'; end if;
   v_minimum:=ceil(v_available::numeric*0.65)::integer;
   v_quantity:=coalesce(v_resource.requested,v_minimum);
   if v_quantity<v_minimum then raise exception 'allocation_minimum_65_percent'; end if;
   if v_quantity>v_available then raise exception 'insufficient_finished_stock'; end if;
   v_budgets:=v_budgets||jsonb_build_array(jsonb_build_object('resourceId',v_resource.id,'quantity',v_quantity));
 end loop;
 if exists(select 1 from jsonb_array_elements(v_items) i,lateral jsonb_array_elements(i->'requirements') r
   where not exists(select 1 from jsonb_array_elements(v_budgets) b where b->>'resourceId'=r->>'resourceId'))
 then raise exception 'unfunded_catalog_resource'; end if;
 insert into public.pos_offline_allocations(id,terminal_id,epoch,catalog_version,service_date,expires_at,funded_by,items,budgets)
 values(p_allocation_id,p_terminal_id,p_epoch,p_catalog_version,v_today,date_trunc('second',p_expires_at),p_manager_id,v_items,v_budgets);
 -- Same finished/daily availability as the online path; any failure rolls back every hold.
 for v_resource in select (b->>'resourceId')::bigint id,(b->>'quantity')::integer quantity
   from jsonb_array_elements(v_budgets) b order by (b->>'resourceId')::bigint loop
   select * into v_finished from public.finished_stock where portion_type_id=v_resource.id for update;
   if not found or v_finished.current_quantity<v_resource.quantity then raise exception 'insufficient_finished_stock'; end if;
   select * into v_daily from public.daily_stock where stock_date=v_today and portion_type_id=v_resource.id for update;
   if found then
     if v_daily.remaining_quantity<v_resource.quantity then raise exception 'insufficient_daily_stock'; end if;
     update public.daily_stock set reserved_quantity=reserved_quantity+v_resource.quantity where stock_date=v_today and portion_type_id=v_resource.id;
   else
     insert into public.daily_stock(stock_date,portion_type_id,starting_quantity,reserved_quantity)
     values(v_today,v_resource.id,v_finished.current_quantity,v_resource.quantity);
   end if;
   update public.finished_stock set current_quantity=current_quantity-v_resource.quantity where portion_type_id=v_resource.id;
   insert into public.finished_stock_movements(portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
   values(v_resource.id,'adjustment',-v_resource.quantity,v_finished.current_quantity-v_resource.quantity,'Offline allocation hold '||p_allocation_id::text);
   insert into public.pos_offline_allocation_resources values(p_allocation_id,v_resource.id,v_resource.quantity);
 end loop;
 insert into public.pos_offline_allocation_targets select allocation_id,portion_type_id,quantity_held,quantity_held from public.pos_offline_allocation_resources where allocation_id=p_allocation_id;
 return p_allocation_id;
end; $$;

create function public.configure_pos_replenishment(p_id uuid,p_allocation uuid,p_enabled boolean,p_limits jsonb,p_manager uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.pos_offline_allocations%rowtype;r jsonb;v_revision bigint;
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 select * into a from public.pos_offline_allocations where id=p_allocation;
 if not found then raise exception 'offline_allocation_unknown';end if;
 perform 1 from public.pos_offline_terminals where terminal_id=a.terminal_id and epoch=a.epoch for update;
 if exists(select 1 from public.pos_offline_replenishment_policies where id=p_id) then
 select to_jsonb(p) into r from public.pos_offline_replenishment_policies p where id=p_id and allocation_id=p_allocation and enabled=p_enabled and limits=p_limits and manager_id=p_manager and reason=p_reason;
 if r is null then raise exception 'offline_policy_identity_conflict';end if;return r;end if;
 if jsonb_typeof(p_limits) is distinct from 'array' or jsonb_array_length(p_limits)<>(select count(*) from public.pos_offline_allocation_targets where allocation_id=a.id)
 or exists(select 1 from jsonb_array_elements(p_limits)x left join public.pos_offline_allocation_targets t on t.allocation_id=a.id and t.portion_type_id=(x->>'resourceId')::bigint
 where t.allocation_id is null or not(x ?& array['resourceId','maxTarget','triggerPercent','warnPercent','maxTopup','approvalAbove'])
 or (x->>'maxTarget')::integer not between 1 and t.target_quantity
 or (x->>'triggerPercent')::integer not between 1 and 99
 or (x->>'warnPercent')::integer not between 1 and (x->>'triggerPercent')::integer
 or (x->>'maxTopup')::integer not between 1 and t.target_quantity
 or (x->>'approvalAbove')::integer not between 0 and (x->>'maxTopup')::integer)
 or (select count(distinct x->>'resourceId') from jsonb_array_elements(p_limits)x)<>jsonb_array_length(p_limits)
 then raise exception 'offline_invalid_replenishment_policy';end if;
 select coalesce(max(revision),0)+1 into v_revision from public.pos_offline_replenishment_policies where allocation_id=a.id;
 insert into public.pos_offline_replenishment_policies(id,allocation_id,revision,enabled,limits,manager_id,reason) values(p_id,a.id,v_revision,p_enabled,p_limits,p_manager,p_reason);
 r:=jsonb_build_object('policyId',p_id,'revision',v_revision,'allocationId',a.id,'enabled',p_enabled);
 insert into public.pos_offline_decisions values(p_id,null,a.terminal_id,a.epoch,'replenishment_policy',p_manager,p_reason,r,now());
 return to_jsonb((select p from public.pos_offline_replenishment_policies p where id=p_id));
end;$$;

create function public.request_pos_replenishment(p_id uuid,p_allocation uuid,p_terminal uuid,p_epoch uuid,p_journal uuid,p_manager uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.pos_offline_allocations%rowtype;t public.pos_offline_terminals%rowtype;p public.pos_offline_replenishment_policies%rowtype;
 b record;lim jsonb;v_available integer;v_balance integer;v_daily integer;v_settled bigint;v_returned bigint;v_deficit bigint;v_quantity integer;
 v_resources jsonb:='[]';v_revision bigint;v_receipt jsonb;v_reason text:='no_eligible_deficit';v_existing public.pos_offline_replenishments%rowtype;
begin
 select * into t from public.pos_offline_terminals where terminal_id=p_terminal and epoch=p_epoch for update;
 if not found or t.journal_id is distinct from p_journal or p_journal is null then raise exception 'offline_original_journal_required';end if;
 select * into v_existing from public.pos_offline_replenishments where id=p_id;
 if found then
 if v_existing.allocation_id<>p_allocation or v_existing.receipt->>'terminalId'<>p_terminal::text or v_existing.receipt->>'epoch'<>p_epoch::text or v_existing.receipt->>'journalId'<>p_journal::text then raise exception 'offline_replenishment_identity_conflict';end if;
 return v_existing.receipt;end if;
 if p_manager is not null then perform public.assert_pos_offline_manager(p_manager,p_reason);end if;
 select * into a from public.pos_offline_allocations where id=p_allocation for update;
 if not found or a.terminal_id<>p_terminal or a.epoch<>p_epoch then raise exception 'offline_allocation_mismatch';end if;
 select * into p from public.pos_offline_replenishment_policies where allocation_id=a.id order by revision desc limit 1;
 if not t.enabled or exists(select 1 from public.pos_offline_controls where terminal_id=p_terminal and epoch=p_epoch and (suspended or revoked)) then v_reason:='terminal_suspended';
 elsif a.state<>'funded' or a.expires_at<=now() or a.service_date<>(now() at time zone 'Africa/Kampala')::date or exists(select 1 from public.pos_offline_closures where allocation_id=a.id) then v_reason:='allocation_closed_or_expired';
 elsif p.id is null or not p.enabled then v_reason:='policy_disabled';
 elsif not exists(select 1 from(select * from public.pos_offline_terminal_reports where terminal_id=p_terminal and epoch=p_epoch order by received_at desc limit 1)r where r.received_at>=now()-interval '2 minutes' and r.body#>>'{status,pending_count}'='0' and r.body#>>'{status,syncEnabled}'='true') then v_reason:='terminal_sync_not_ready';

 elsif exists(select 1 from public.pos_offline_replenishments r where r.allocation_id=a.id and r.revision is not null and not exists(select 1 from public.pos_offline_replenishment_acks k where k.id=r.id)) then v_reason:='activation_pending';
 else
 for b in select ar.*,tr.target_quantity from public.pos_offline_allocation_resources ar join public.pos_offline_allocation_targets tr using(allocation_id,portion_type_id)
 where ar.allocation_id=a.id order by portion_type_id for update of ar loop
 select x into lim from jsonb_array_elements(p.limits)x where (x->>'resourceId')::bigint=b.portion_type_id;
 select coalesce(sum(quantity),0) into v_settled from public.pos_offline_stock_settlements where allocation_id=a.id and portion_type_id=b.portion_type_id;
 select coalesce(sum(quantity),0) into v_returned from public.pos_offline_stock_returns where allocation_id=a.id and portion_type_id=b.portion_type_id;
 v_deficit:=least(b.target_quantity,(lim->>'maxTarget')::integer)-(b.quantity_held-v_settled-v_returned);
 if v_deficit<=0 or (p_manager is null and (b.quantity_held-v_settled-v_returned)*100>least(b.target_quantity,(lim->>'maxTarget')::integer)*(lim->>'triggerPercent')::integer) then continue;end if;
 select current_quantity into v_available from public.finished_stock where portion_type_id=b.portion_type_id for update;
 select remaining_quantity into v_daily from public.daily_stock where stock_date=a.service_date and portion_type_id=b.portion_type_id for update;
 v_available:=greatest(0,least(coalesce(v_available,0),coalesce(v_daily,0)));
 v_quantity:=least(v_deficit,(lim->>'maxTopup')::integer,v_available,case when p_manager is null then (lim->>'approvalAbove')::integer else (lim->>'maxTopup')::integer end);
 if v_quantity<=0 then continue;end if;
 update public.finished_stock set current_quantity=current_quantity-v_quantity where portion_type_id=b.portion_type_id returning current_quantity into v_balance;
 update public.daily_stock set reserved_quantity=reserved_quantity+v_quantity where stock_date=a.service_date and portion_type_id=b.portion_type_id;
 insert into public.finished_stock_movements(portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
 values(b.portion_type_id,'adjustment',-v_quantity,v_balance,'Offline replenishment '||p_id::text);
 update public.pos_offline_allocation_resources set quantity_held=quantity_held+v_quantity where allocation_id=a.id and portion_type_id=b.portion_type_id;
 v_resources:=v_resources||jsonb_build_array(jsonb_build_object('resourceId',b.portion_type_id,'quantity',v_quantity));
 end loop;
 end if;
 if jsonb_array_length(v_resources)>0 then select coalesce(max(revision),0)+1 into v_revision from public.pos_offline_replenishments where allocation_id=a.id;v_reason:='funded';end if;
 v_receipt:=jsonb_build_object('version',1,'id',p_id,'allocationId',a.id,'terminalId',p_terminal,'epoch',p_epoch,'journalId',p_journal,'catalogVersion',a.catalog_version,
 'serviceDate',a.service_date,'expiresAt',floor(extract(epoch from a.expires_at)*1000),'issuedAt',floor(extract(epoch from now())*1000),
 'revision',v_revision,'policyRevision',p.revision,'resources',v_resources,'disposition',v_reason);
 insert into public.pos_offline_replenishments(id,allocation_id,revision,policy_id,receipt,manager_id) values(p_id,a.id,v_revision,p.id,v_receipt,p_manager);
 if p_manager is not null then insert into public.pos_offline_decisions values(p_id,null,p_terminal,p_epoch,'manager_replenishment',p_manager,p_reason,v_receipt,now());end if;
 return v_receipt;
end;$$;

create function public.ack_pos_replenishment(p_body jsonb,p_signature text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.pos_offline_replenishments%rowtype;t public.pos_offline_terminals%rowtype;v_activation jsonb;
begin
 select * into t from public.pos_offline_terminals where terminal_id=(p_body->>'terminalId')::uuid and epoch=(p_body->>'epoch')::uuid for update;
 select * into r from public.pos_offline_replenishments where id=(p_body->>'replenishmentId')::uuid;
 if r.id is null or r.revision is null or r.receipt->>'terminalId'<>t.terminal_id::text or r.receipt->>'epoch'<>t.epoch::text
 or r.allocation_id::text is distinct from p_body->>'allocationId' or t.journal_id::text is distinct from p_body->>'journalId' or p_body->>'receiptHash' is distinct from public.pos_offline_payload_hash(r.receipt)
 then raise exception 'offline_replenishment_ack_mismatch';end if;
 if not exists(select 1 from public.pos_offline_replenishment_acks where id=r.id) and (not t.enabled or exists(select 1 from public.pos_offline_controls where terminal_id=t.terminal_id and epoch=t.epoch and (suspended or revoked))) then raise exception 'offline_terminal_suspended';end if;
 if exists(select 1 from public.pos_offline_closures where allocation_id=r.allocation_id) then raise exception 'offline_allocation_closed';end if;
 v_activation:=jsonb_build_object('id',r.id,'allocationId',r.allocation_id,'terminalId',t.terminal_id,'epoch',t.epoch,'journalId',t.journal_id,'revision',r.revision,
 'receiptHash',public.pos_offline_payload_hash(r.receipt));
 insert into public.pos_offline_replenishment_acks(id,body,signature,activation) values(r.id,p_body,p_signature,v_activation) on conflict(id) do nothing;
 if not exists(select 1 from public.pos_offline_replenishment_acks where id=r.id and body=p_body) then raise exception 'offline_replenishment_ack_identity_conflict';end if;
 return (select activation from public.pos_offline_replenishment_acks where id=r.id);
end;$$;

create function public.get_pos_replenishment_state(p_terminal uuid,p_epoch uuid,p_journal uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('allocationId',a.id,'expiresAt',floor(extract(epoch from a.expires_at)*1000),'policy',to_jsonb(p),
 'receipts',coalesce((select jsonb_agg(r.receipt order by r.revision) from public.pos_offline_replenishments r where r.allocation_id=a.id and r.revision is not null and not exists(select 1 from public.pos_offline_replenishment_acks k where k.id=r.id)),'[]'))),'[]')
 from public.pos_offline_allocations a join public.pos_offline_terminals t using(terminal_id,epoch)
 left join lateral(select * from public.pos_offline_replenishment_policies p where p.allocation_id=a.id order by revision desc limit 1)p on true
 where a.terminal_id=p_terminal and a.epoch=p_epoch and t.journal_id=p_journal and a.state='funded';
$$;


-- Settlement may consume only funding activated before original capture, never an unacknowledged reservation.
create function public.guard_pos_replenished_settlement() returns trigger language plpgsql security definer set search_path=public as $$
declare v_initial bigint;v_added bigint;v_used bigint;v_capture timestamptz;
begin
 select initial_quantity into v_initial from public.pos_offline_allocation_targets where allocation_id=new.allocation_id and portion_type_id=new.portion_type_id;
 select paid_at into v_capture from public.orders where id=new.order_id;
 select coalesce(sum((x->>'quantity')::bigint),0) into v_added from public.pos_offline_replenishments r
 join public.pos_offline_replenishment_acks k on k.id=r.id,lateral jsonb_array_elements(r.receipt->'resources')x
 where r.allocation_id=new.allocation_id and (x->>'resourceId')::bigint=new.portion_type_id and k.created_at<=v_capture+interval '1 second';
 select coalesce(sum(quantity),0) into v_used from public.pos_offline_stock_settlements where allocation_id=new.allocation_id and portion_type_id=new.portion_type_id;
 if v_initial is null or new.quantity>v_initial+v_added-v_used then raise exception 'offline_unactivated_funding_or_overconsumption';end if;return new;
end;$$;
create trigger replenished_settlement_guard before insert on public.pos_offline_stock_settlements for each row execute function public.guard_pos_replenished_settlement();
revoke all on function public.guard_pos_replenished_settlement() from public,anon,authenticated,service_role;

create or replace function public.record_pos_offline_closure(p_body jsonb,p_signature text,p_hash text) returns uuid
language plpgsql security definer set search_path=public as $$
declare a public.pos_offline_allocations%rowtype;v_entry jsonb;s bigint:=(p_body->>'sequence')::bigint;
begin
 if p_hash is distinct from public.pos_offline_payload_hash(p_body) then raise exception 'offline_payload_hash_mismatch';end if;
 perform 1 from public.pos_offline_terminals where terminal_id=(p_body->>'terminalId')::uuid and epoch=(p_body->>'epoch')::uuid for update;
 select * into a from public.pos_offline_allocations where id=(p_body->>'allocationId')::uuid for update;
 if not found or a.terminal_id<>(p_body->>'terminalId')::uuid or a.epoch<>(p_body->>'epoch')::uuid then raise exception 'offline_allocation_mismatch';end if;
 if s<0 or jsonb_typeof(p_body->'manifest')<>'array' or jsonb_array_length(p_body->'manifest')<>s or
 (select count(distinct (x->>'sequence')::bigint) from jsonb_array_elements(p_body->'manifest') x)<>s or
 exists(select 1 from jsonb_array_elements(p_body->'manifest') x where (x->>'sequence')::bigint not between 1 and s) or
 exists(select 1 from public.pos_offline_ingestions i where i.terminal_id=a.terminal_id and i.epoch=a.epoch and
 not exists(select 1 from jsonb_array_elements(p_body->'manifest') x where x->>'transactionId'=i.transaction_id::text and (x->>'sequence')::bigint=i.terminal_sequence and x->>'payloadHash'=i.payload_hash))
 then raise exception 'offline_closure_stale_or_sequence_gap';end if;
 for v_entry in select value from jsonb_array_elements(p_body->'manifest') loop
 if not exists(select 1 from public.pos_offline_ingestions i where i.transaction_id=(v_entry->>'transactionId')::uuid and i.terminal_id=a.terminal_id and i.epoch=a.epoch and i.terminal_sequence=(v_entry->>'sequence')::bigint and i.payload_hash=v_entry->>'payloadHash' and i.envelope->>'allocationId'=v_entry->>'allocationId'
 and v_entry->'resources'=(select coalesce(jsonb_agg(jsonb_build_object('resourceId',resource_id,'quantity',quantity) order by resource_id),'[]') from(
 select (r->>'resourceId')::bigint resource_id,sum((x->>'quantity')::bigint*(r->>'quantity')::bigint) quantity from jsonb_array_elements(i.envelope->'items') x,lateral jsonb_array_elements(x->'requirements') r group by (r->>'resourceId')::bigint) z))
 then raise exception 'offline_closure_manifest_mismatch';end if;
 if not exists(select 1 from public.pos_offline_ingestions i where i.transaction_id=(v_entry->>'transactionId')::uuid and i.payload_hash=v_entry->>'payloadHash'
 and (i.order_id is not null or exists(select 1 from public.pos_offline_approved_postings p where p.transaction_id=i.transaction_id)
 or exists(select 1 from public.pos_offline_decisions d where d.transaction_id=i.transaction_id and d.action='confirmed_duplicate')))
 then raise exception 'offline_closure_unresolved_sale';end if;
 end loop;
 if exists(select 1 from public.pos_offline_replenishments z where z.allocation_id=a.id and z.revision is not null and not exists(select 1 from jsonb_array_elements(coalesce(p_body->'fundingReceipts','[]')) f where f->>'id'=z.id::text and f->>'receiptHash'=public.pos_offline_payload_hash(z.receipt))) or jsonb_array_length(coalesce(p_body->'fundingReceipts','[]'))<>(select count(*) from public.pos_offline_replenishments z where z.allocation_id=a.id and z.revision is not null) then raise exception 'offline_closure_funding_gap';end if;
 if jsonb_typeof(p_body->'unused')<>'array' or jsonb_array_length(p_body->'unused')<>(select count(*) from public.pos_offline_allocation_resources where allocation_id=a.id) or
 (select count(distinct x->>'resourceId') from jsonb_array_elements(p_body->'unused')x)<>jsonb_array_length(p_body->'unused') or
 exists(select 1 from public.pos_offline_allocation_resources ar where ar.allocation_id=a.id and ar.quantity_held-coalesce((
 select sum((r->>'quantity')::bigint) from jsonb_array_elements(p_body->'manifest')m,lateral jsonb_array_elements(m->'resources')r
 where m->>'allocationId'=a.id::text and (r->>'resourceId')::bigint=ar.portion_type_id),0) is distinct from
 (select (u->>'quantity')::bigint from jsonb_array_elements(p_body->'unused')u where (u->>'resourceId')::bigint=ar.portion_type_id)) then raise exception 'offline_closure_budget_mismatch';end if;
 insert into public.pos_offline_closures(allocation_id,terminal_id,epoch,terminal_sequence,body,payload_hash,signature)
 values(a.id,a.terminal_id,a.epoch,s,p_body,p_hash,p_signature) on conflict(allocation_id) do nothing;
 if not exists(select 1 from public.pos_offline_closures where allocation_id=a.id and payload_hash=p_hash and body=p_body) then raise exception 'offline_closure_identity_conflict';end if;
 return a.id;
end; $$;



alter function public.get_pos_offline_operations(uuid,jsonb) rename to get_pos_offline_operations_v110;
revoke all on function public.get_pos_offline_operations_v110(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.get_pos_offline_operations(p_manager uuid,p_filters jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb;
begin
 r:=public.get_pos_offline_operations_v110(p_manager,p_filters);
 return jsonb_set(r,'{allocations}',coalesce((select jsonb_agg(x||jsonb_build_object(
 'initialFunding',tr.initial_quantity,'target',tr.target_quantity,'additionalFunding',ar.quantity_held-tr.initial_quantity,
 'sharedAvailable',least(f.current_quantity,d.remaining_quantity),'replenishmentPolicy',to_jsonb(p),
 'terminalReportedAt',lr.received_at,'lastReportedLocalConsumed',local_resource->'consumed','remainingLocalAllowance',local_resource->'remaining','lowAllocation',local_resource->'low','localPendingReplenishment',local_resource->'pendingRequest',
 'lastReplenishment',(select receipt from public.pos_offline_replenishments z where z.allocation_id=ar.allocation_id and z.revision is not null order by z.revision desc limit 1),
 'pendingActivation',(select coalesce(sum((v->>'quantity')::integer),0) from public.pos_offline_replenishments z,lateral jsonb_array_elements(z.receipt->'resources')v where z.allocation_id=ar.allocation_id and (v->>'resourceId')::bigint=ar.portion_type_id and not exists(select 1 from public.pos_offline_replenishment_acks k where k.id=z.id))))
 from jsonb_array_elements(r->'allocations')x join public.pos_offline_allocation_resources ar on ar.allocation_id=(x->>'allocationId')::uuid and ar.portion_type_id=(x->>'resourceId')::bigint
 join public.pos_offline_allocation_targets tr using(allocation_id,portion_type_id)
 join public.finished_stock f on f.portion_type_id=ar.portion_type_id join public.pos_offline_allocations a on a.id=ar.allocation_id
 join public.daily_stock d on d.portion_type_id=ar.portion_type_id and d.stock_date=a.service_date
 left join lateral(select * from public.pos_offline_replenishment_policies z where z.allocation_id=a.id order by revision desc limit 1)p on true
 left join lateral(select * from public.pos_offline_terminal_reports z where z.terminal_id=a.terminal_id and z.epoch=a.epoch order by received_at desc limit 1)lr on true
 left join lateral(select value local_resource from jsonb_array_elements(coalesce(lr.body#>'{status,replenishment}','[]')) where value->>'allocationId'=a.id::text and (value->>'resourceId')::bigint=ar.portion_type_id)lo on true),'[]'));
end;$$;


-- Physical-resource report; never join funding totals through multiple menu representations.
create function public.get_pos_offline_resource_rollup(p_date date)
returns table(portion_type_id bigint,initial_funding bigint,additional_funding bigint,total_funded bigint,cloud_settled bigint,returned bigint,outstanding_hold bigint,verified_unused bigint,unresolved_consumption bigint)
language sql stable security definer set search_path=public as $$
 select ar.portion_type_id,sum(t.initial_quantity)::bigint,sum(ar.quantity_held-t.initial_quantity)::bigint,sum(ar.quantity_held)::bigint,
 sum(coalesce(s.quantity,0))::bigint,sum(coalesce(r.quantity,0))::bigint,sum(ar.quantity_held-coalesce(s.quantity,0)-coalesce(r.quantity,0))::bigint,
 case when bool_and(c.allocation_id is not null) then sum(u.quantity)::bigint end,
 case when bool_and(c.allocation_id is not null) then sum(ar.quantity_held-u.quantity-coalesce(s.quantity,0))::bigint end
 from public.pos_offline_allocation_resources ar join public.pos_offline_allocation_targets t using(allocation_id,portion_type_id)
 join public.pos_offline_allocations a on a.id=ar.allocation_id
 left join(select allocation_id,portion_type_id,sum(quantity) quantity from public.pos_offline_stock_settlements group by allocation_id,portion_type_id)s using(allocation_id,portion_type_id)
 left join public.pos_offline_stock_returns r using(allocation_id,portion_type_id)
 left join public.pos_offline_closures c on c.allocation_id=a.id
 left join lateral(select (x->>'quantity')::bigint quantity from jsonb_array_elements(c.body->'unused')x where (x->>'resourceId')::bigint=ar.portion_type_id)u on true
 where a.service_date=p_date group by ar.portion_type_id;
$$;
revoke all on function public.get_pos_offline_resource_rollup(date) from public,anon,authenticated;
grant execute on function public.get_pos_offline_resource_rollup(date) to service_role;

-- Update manager funding audit metadata without changing its financial delegation.
create or replace function public.fund_manager_pos_allocation(p_id uuid,p_terminal uuid,p_epoch uuid,p_catalog uuid,p_items bigint[],p_budgets jsonb,p_expires timestamptz,p_manager uuid,p_reason text,p_decision uuid) returns uuid
language plpgsql security definer set search_path=public as $$
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 perform 1 from public.pos_offline_terminals where terminal_id=p_terminal and epoch=p_epoch for update;
 if exists(select 1 from public.pos_offline_controls where terminal_id=p_terminal and epoch=p_epoch and (suspended or revoked)) then raise exception 'offline_terminal_suspended';end if;
 perform public.fund_pos_offline_allocation(p_id,p_terminal,p_epoch,p_catalog,p_items,p_budgets,p_expires,p_manager);
 insert into public.pos_offline_decisions values(p_decision,null,p_terminal,p_epoch,'fund_allocation',p_manager,p_reason,jsonb_build_object('allocationId',p_id,'minimumPercent',65),now());return p_id;
end;$$;



do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('configure_pos_replenishment','request_pos_replenishment','ack_pos_replenishment','get_pos_replenishment_state','get_pos_offline_operations','fund_pos_offline_allocation','fund_manager_pos_allocation','record_pos_offline_closure') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);end loop;end;$$;
commit;
