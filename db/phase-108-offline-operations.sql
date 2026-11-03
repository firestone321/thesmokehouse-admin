-- Phase 3C operations. Prepared only; never applied to production by this task.
begin;
create table public.pos_offline_controls(
 terminal_id uuid not null,epoch uuid not null,revision bigint not null default 1,
 suspended boolean not null default false,revoked boolean not null default false,
 changed_by uuid references public.profiles(id),reason text not null,changed_at timestamptz not null default now(),
 primary key(terminal_id,epoch),foreign key(terminal_id,epoch) references public.pos_offline_terminals(terminal_id,epoch));
create table public.pos_offline_terminal_reports(
 id uuid primary key,terminal_id uuid not null,epoch uuid not null,received_at timestamptz not null default now(),
 terminal_sequence bigint not null check(terminal_sequence>=0),body jsonb not null,signature text not null,
 foreign key(terminal_id,epoch) references public.pos_offline_terminals(terminal_id,epoch));
create index pos_offline_reports_latest on public.pos_offline_terminal_reports(terminal_id,epoch,received_at desc);
create table public.pos_offline_conflict_evidence(
 id uuid primary key default gen_random_uuid(),transaction_id uuid not null,payload_hash text not null,
 envelope jsonb not null,signature text not null,grant_evidence jsonb not null,reason text not null,
 recorded_at timestamptz not null default now(),unique(transaction_id,payload_hash));
create table public.pos_offline_approved_postings(
 transaction_id uuid primary key references public.pos_offline_ingestions(transaction_id),
 order_id bigint not null unique references public.orders(id),acknowledgement jsonb not null,
 approved_by uuid not null references public.profiles(id),reason text not null,created_at timestamptz not null default now());
create table public.pos_offline_decisions(
 id uuid primary key,transaction_id uuid,terminal_id uuid,epoch uuid,action text not null,
 reviewer_id uuid not null references public.profiles(id),reason text not null check(length(btrim(reason)) between 10 and 2000),
 result jsonb not null,created_at timestamptz not null default now());
create table public.pos_offline_close_resolutions(
 transaction_id uuid primary key references public.pos_offline_close_adjustments(transaction_id),
 decision_id uuid not null unique references public.pos_offline_decisions(id),snapshot_id uuid not null references public.daily_close_snapshots(id),
 order_id bigint not null references public.orders(id),service_date date not null,cash_adjustment integer not null check(cash_adjustment>0),
 reviewer_id uuid not null references public.profiles(id),reason text not null,created_at timestamptz not null default now());
create table public.pos_offline_closures(
 allocation_id uuid primary key references public.pos_offline_allocations(id),terminal_id uuid not null,epoch uuid not null,
 terminal_sequence bigint not null,body jsonb not null,payload_hash text not null,signature text not null,
 received_at timestamptz not null default now(),foreign key(terminal_id,epoch) references public.pos_offline_terminals(terminal_id,epoch));
create table public.pos_offline_stock_returns(
 allocation_id uuid not null,portion_type_id bigint not null,quantity integer not null check(quantity>0),
 reviewer_id uuid not null references public.profiles(id),reason text not null,returned_at timestamptz not null default now(),
 primary key(allocation_id,portion_type_id),foreign key(allocation_id,portion_type_id) references public.pos_offline_allocation_resources(allocation_id,portion_type_id));
create table public.pos_offline_recovery_permits(
 id uuid primary key,terminal_id uuid not null,epoch uuid not null,backup_hash text not null,
 minimum_sequence bigint not null,issued_by uuid not null references public.profiles(id),reason text not null,
 issued_at timestamptz not null default now(),foreign key(terminal_id,epoch) references public.pos_offline_terminals(terminal_id,epoch));
create function public.assert_pos_offline_manager(p_manager uuid,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if length(btrim(coalesce(p_reason,''))) not between 10 and 2000 or not exists(
 select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_manager and p.role in ('admin','manager') and coalesce(u.banned_until,now())<=now())
 then raise exception 'offline_manager_and_reason_required'; end if;
end; $$;
do $$
declare t text;
begin
 foreach t in array array['pos_offline_controls','pos_offline_terminal_reports','pos_offline_conflict_evidence','pos_offline_approved_postings','pos_offline_decisions','pos_offline_close_resolutions','pos_offline_closures','pos_offline_stock_returns','pos_offline_recovery_permits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to service_role',t);
 if t<>'pos_offline_controls' then
 execute format('create trigger immutable_operations_evidence before update or delete on public.%I for each row execute function public.pos_offline_immutable_evidence()',t);
 end if;
 end loop;
end; $$;

create function public.manage_pos_offline_terminal(p_manager uuid,p_terminal uuid,p_epoch uuid,p_action text,p_reason text,p_decision uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 if exists(select 1 from public.pos_offline_decisions where id=p_decision) then
 select result into r from public.pos_offline_decisions where id=p_decision and reviewer_id=p_manager and action=p_action and reason=p_reason and terminal_id=p_terminal and epoch=p_epoch;
 if r is null then raise exception 'offline_decision_identity_conflict'; end if;return r;end if;
 perform 1 from public.pos_offline_terminals where terminal_id=p_terminal and epoch=p_epoch for update;
 if not found then raise exception 'offline_terminal_unknown';end if;
 if p_action not in ('suspend','resume','revoke','prepare_replacement','handover','authorize_closure') then raise exception 'offline_invalid_terminal_action';end if;
 if p_action not in ('handover','authorize_closure') then
 if p_action='resume' and exists(select 1 from public.pos_offline_controls where terminal_id=p_terminal and epoch=p_epoch and revoked) then raise exception 'offline_revoked_epoch_requires_replacement';end if;
 insert into public.pos_offline_controls(terminal_id,epoch,suspended,revoked,changed_by,reason)
 values(p_terminal,p_epoch,p_action<>'resume',p_action in ('revoke','prepare_replacement'),p_manager,p_reason)
 on conflict(terminal_id,epoch) do update set revision=pos_offline_controls.revision+1,suspended=excluded.suspended,
 revoked=pos_offline_controls.revoked or excluded.revoked,changed_by=p_manager,reason=p_reason,changed_at=now();
 if p_action in ('revoke','prepare_replacement') then
 update public.pos_offline_terminals set enabled=false where terminal_id=p_terminal and epoch=p_epoch;end if;
 end if;
 r:=jsonb_build_object('action',p_action,'terminalId',p_terminal,'epoch',p_epoch,'noStockReleased',true);
 insert into public.pos_offline_decisions values(p_decision,null,p_terminal,p_epoch,p_action,p_manager,p_reason,r,now());
 return r;
end; $$;

create function public.record_pos_offline_terminal_report(p_body jsonb,p_signature text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t uuid:=(p_body->>'terminalId')::uuid;e uuid:=(p_body->>'epoch')::uuid;r jsonb;
begin
 perform 1 from public.pos_offline_terminals where terminal_id=t and epoch=e;
 if not found then raise exception 'offline_terminal_unknown';end if;
 if (p_body->>'sequence')::bigint<greatest(coalesce((select max(terminal_sequence) from public.pos_offline_ingestions where terminal_id=t and epoch=e),0),coalesce((select max(terminal_sequence) from public.pos_offline_terminal_reports where terminal_id=t and epoch=e),0)) then
 insert into public.pos_offline_controls(terminal_id,epoch,suspended,revoked,changed_by,reason) values(t,e,true,false,null,'Automatic sequence regression suspension; supervised recovery required')
 on conflict(terminal_id,epoch) do update set revision=pos_offline_controls.revision+1,suspended=true,changed_by=null,reason=excluded.reason,changed_at=now();
 end if;
 if (p_body->>'sequence')::bigint<0 or jsonb_typeof(p_body->'status')<>'object' then raise exception 'offline_invalid_report';end if;
 insert into public.pos_offline_terminal_reports(id,terminal_id,epoch,terminal_sequence,body,signature)
 values((p_body->>'reportId')::uuid,t,e,(p_body->>'sequence')::bigint,p_body,p_signature) on conflict(id) do nothing;
 if not exists(select 1 from public.pos_offline_terminal_reports where id=(p_body->>'reportId')::uuid and body=p_body and signature=p_signature)
 then raise exception 'offline_report_identity_conflict';end if;
 select jsonb_build_object('revision',coalesce(c.revision,0),'suspended',coalesce(c.suspended,false) or not tr.enabled,'revoked',coalesce(c.revoked,false))
 into r from public.pos_offline_terminals tr left join public.pos_offline_controls c using(terminal_id,epoch) where tr.terminal_id=t and tr.epoch=e;
 return jsonb_build_object('control',r,'resolutions',coalesce((
 select jsonb_agg(jsonb_build_object('transactionId',i.transaction_id,'payloadHash',i.payload_hash,'decisionId',d.id,
 'state',case when d.action='confirmed_duplicate' then 'confirmed_duplicate' else 'reconciled' end,
 'orderId',coalesce(i.order_id,ap.order_id,(d.result->>'orderId')::bigint)))
 from public.pos_offline_ingestions i left join public.pos_offline_approved_postings ap using(transaction_id)
 join lateral(select * from public.pos_offline_decisions d where d.transaction_id=i.transaction_id and d.action in('confirm_genuine','confirmed_duplicate','resolve_late') order by d.created_at,d.id limit 1)d on true
 where i.terminal_id=t and i.epoch=e and exists(select 1 from jsonb_array_elements(coalesce(p_body#>'{status,issues}','[]')) x where x->>'transactionId'=i.transaction_id::text and x->>'payloadHash'=i.payload_hash) and not exists(select 1 from public.pos_offline_close_adjustments a where a.transaction_id=i.transaction_id and not exists(select 1 from public.pos_offline_close_resolutions s where s.transaction_id=a.transaction_id))),'[]'));
end; $$;

create function public.archive_pos_offline_conflict(p_envelope jsonb,p_signature text,p_hash text,p_grant jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if public.pos_offline_payload_hash(p_envelope) is distinct from p_hash then raise exception 'offline_payload_hash_mismatch';end if;
 insert into public.pos_offline_conflict_evidence(transaction_id,payload_hash,envelope,signature,grant_evidence,reason)
 values((p_envelope->>'transactionId')::uuid,p_hash,p_envelope,p_signature,p_grant,left(p_reason,100)) on conflict(transaction_id,payload_hash) do nothing;
 select id into v_id from public.pos_offline_conflict_evidence where transaction_id=(p_envelope->>'transactionId')::uuid and payload_hash=p_hash;
 return v_id;
end; $$;

create function public.record_pos_offline_closure(p_body jsonb,p_signature text,p_hash text) returns uuid
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

create function public.return_pos_offline_unused(p_manager uuid,p_allocation uuid,p_reason text,p_decision uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.pos_offline_allocations%rowtype;c public.pos_offline_closures%rowtype;b record;q bigint;used bigint;current_stock integer;r jsonb;
 v_today date:=(now() at time zone 'Africa/Kampala')::date;
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 if exists(select 1 from public.pos_offline_decisions where id=p_decision) then
 select result into r from public.pos_offline_decisions where id=p_decision and action='return_unused' and reviewer_id=p_manager and reason=p_reason and result->>'allocationId'=p_allocation::text;
 if r is null then raise exception 'offline_decision_identity_conflict';end if;return r;end if;
 select * into a from public.pos_offline_allocations where id=p_allocation;
 if not found then raise exception 'offline_allocation_unknown';end if;
 perform 1 from public.pos_offline_terminals where terminal_id=a.terminal_id and epoch=a.epoch for update;
 select * into a from public.pos_offline_allocations where id=p_allocation for update;
 select * into c from public.pos_offline_closures where allocation_id=a.id;
 if not found or now()<a.expires_at then raise exception 'offline_durable_closure_and_grant_expiry_required';end if;
 if exists(select 1 from public.pos_offline_ingestions i where i.terminal_id=a.terminal_id and i.epoch=a.epoch and i.terminal_sequence>c.terminal_sequence) then raise exception 'offline_closure_stale_or_sequence_gap';end if;
 for b in select * from public.pos_offline_allocation_resources where allocation_id=a.id order by portion_type_id for update loop
 select coalesce(sum((x->>'quantity')::bigint),0) into used
 from jsonb_array_elements(c.body->'manifest') m, lateral jsonb_array_elements(m->'resources') x
 where m->>'allocationId'=a.id::text and (x->>'resourceId')::bigint=b.portion_type_id;
 q:=b.quantity_held-used;
 if q<0 or q is distinct from (select (x->>'quantity')::bigint from jsonb_array_elements(c.body->'unused') x where (x->>'resourceId')::bigint=b.portion_type_id) then raise exception 'offline_closure_budget_mismatch';end if;
 if q>b.quantity_held-coalesce((select sum(quantity) from public.pos_offline_stock_settlements where allocation_id=a.id and portion_type_id=b.portion_type_id),0) then raise exception 'offline_return_exceeds_outstanding_hold';end if;
 if q>0 then
 insert into public.pos_offline_stock_returns values(a.id,b.portion_type_id,q::integer,p_manager,p_reason,now()) on conflict do nothing;
 if found then
 select current_quantity into current_stock from public.finished_stock where portion_type_id=b.portion_type_id for update;
 update public.daily_stock set reserved_quantity=reserved_quantity-q::integer where stock_date=a.service_date and portion_type_id=b.portion_type_id and reserved_quantity>=q;
 if not found then raise exception 'offline_daily_hold_missing';end if;
 if v_today<>a.service_date then update public.daily_stock set starting_quantity=starting_quantity+q::integer where stock_date=v_today and portion_type_id=b.portion_type_id;end if;
 update public.finished_stock set current_quantity=current_quantity+q::integer where portion_type_id=b.portion_type_id returning current_quantity into current_stock;
 insert into public.finished_stock_movements(portion_type_id,movement_type,quantity_delta,resulting_quantity,note)
 values(b.portion_type_id,'adjustment',q::integer,current_stock,'Verified unused offline allocation return '||a.id::text);
 end if;end if;
 end loop;
 if not exists(select 1 from public.pos_offline_allocation_resources ar where ar.allocation_id=a.id and ar.quantity_held>
 coalesce((select sum(s.quantity) from public.pos_offline_stock_settlements s where s.allocation_id=ar.allocation_id and s.portion_type_id=ar.portion_type_id),0)+
 coalesce((select sum(t.quantity) from public.pos_offline_stock_returns t where t.allocation_id=ar.allocation_id and t.portion_type_id=ar.portion_type_id),0))
 then update public.pos_offline_allocations set state='reconciled' where id=a.id;end if;
 r:=jsonb_build_object('allocationId',a.id,'status',(select state from public.pos_offline_allocations where id=a.id));
 insert into public.pos_offline_decisions values(p_decision,null,a.terminal_id,a.epoch,'return_unused',p_manager,p_reason,r,now());return r;
end; $$;

-- Service-only trusted server boundary; no public/browser financial writes.
do $$
declare f record;
begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
 p.proname in ('assert_pos_offline_manager','manage_pos_offline_terminal','record_pos_offline_terminal_report','archive_pos_offline_conflict','record_pos_offline_closure','return_pos_offline_unused') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);end loop;
end; $$;
commit;
