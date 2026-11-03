begin;
create function public.enroll_manager_pos_terminal(p_terminal uuid,p_epoch uuid,p_key text,p_manager uuid,p_reason text,p_decision uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_key,110));
 if exists(select 1 from public.pos_offline_terminals where terminal_key=p_key) then raise exception 'offline_active_key_reuse_forbidden';end if;
 perform public.register_pos_offline_terminal(p_terminal,p_epoch,p_key,p_manager);
 r:=jsonb_build_object('terminalId',p_terminal,'epoch',p_epoch,'terminalKey',p_key);
 insert into public.pos_offline_decisions values(p_decision,null,p_terminal,p_epoch,'enroll',p_manager,p_reason,r,now());return r;
end;$$;
create function public.fund_manager_pos_allocation(p_id uuid,p_terminal uuid,p_epoch uuid,p_catalog uuid,p_items bigint[],p_budgets jsonb,p_expires timestamptz,p_manager uuid,p_reason text,p_decision uuid) returns uuid
language plpgsql security definer set search_path=public as $$
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 perform 1 from public.pos_offline_terminals where terminal_id=p_terminal and epoch=p_epoch for update;
 if exists(select 1 from public.pos_offline_controls where terminal_id=p_terminal and epoch=p_epoch and (suspended or revoked)) then raise exception 'offline_terminal_suspended';end if;
 perform public.fund_pos_offline_allocation(p_id,p_terminal,p_epoch,p_catalog,p_items,p_budgets,p_expires,p_manager);
 insert into public.pos_offline_decisions values(p_decision,null,p_terminal,p_epoch,'fund_allocation',p_manager,p_reason,jsonb_build_object('allocationId',p_id,'minimumPercent',35),now());return p_id;
end;$$;

create function public.get_pos_offline_operations(p_manager uuid,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.assert_pos_offline_manager(p_manager,'View offline operational evidence');
 return jsonb_build_object(
 'records',coalesce((
 select jsonb_agg(to_jsonb(filtered)) from(select * from(
 select i.transaction_id,i.terminal_id,i.epoch,i.terminal_sequence,i.receipt_id,i.captured_at,
 i.envelope->>'cashierId' cashier_id,i.service_date,(i.envelope#>>'{receipt,total}')::integer cash_total,
 coalesce(i.order_id,ap.order_id) order_id,
 case when exists(select 1 from public.pos_offline_decisions d where d.transaction_id=i.transaction_id and d.action='close_incident') then 'closed'
 when exists(select 1 from public.pos_offline_close_adjustments a where a.transaction_id=i.transaction_id and not exists(select 1 from public.pos_offline_close_resolutions s where s.transaction_id=a.transaction_id)) then 'late_close'
 when ap.order_id is not null then 'approved_posted'
 when exists(select 1 from public.pos_offline_decisions d where d.transaction_id=i.transaction_id and d.action='confirmed_duplicate') then 'confirmed_duplicate'
 when exists(select 1 from public.pos_offline_decisions d where d.transaction_id=i.transaction_id and d.action='flag_duplicate') then 'suspected_duplicate'
 when i.acknowledgement->>'disposition'='needs_review' then i.acknowledgement->>'reason'
 else i.acknowledgement->>'disposition' end issue,
 i.envelope-'authorization' evidence,i.payload_hash,i.signature,
 (select jsonb_agg(jsonb_build_object('decisionId',d.id,'action',d.action,'reviewer',d.reviewer_id,'reason',d.reason,'result',d.result,'at',d.created_at) order by d.created_at)
 from public.pos_offline_decisions d where d.transaction_id=i.transaction_id) decisions
 from public.pos_offline_ingestions i left join public.pos_offline_approved_postings ap using(transaction_id)
 where (coalesce(p_filters->>'terminal','')='' or i.terminal_id::text=p_filters->>'terminal')
 and (coalesce(p_filters->>'cashier','')='' or i.envelope->>'cashierId'=p_filters->>'cashier')
 and (coalesce(p_filters->>'date','')='' or i.service_date::text=p_filters->>'date')
 and (coalesce(p_filters->>'transaction','')='' or i.transaction_id::text=p_filters->>'transaction')
 ) q
 where (coalesce(p_filters->>'issue','')='' or q.issue=p_filters->>'issue')
 and (coalesce(p_filters->>'status','')='' or (p_filters->>'status'='closed')=(q.issue='closed')) order by q.captured_at desc limit 200) filtered),'[]'),
 'conflicts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'transactionId',transaction_id,'hash',payload_hash,'reason',reason,'evidence',envelope-'authorization','signature',signature,'at',recorded_at)) from(select * from public.pos_offline_conflict_evidence where (coalesce(p_filters->>'terminal','')='' or envelope->>'terminalId'=p_filters->>'terminal') and (coalesce(p_filters->>'cashier','')='' or envelope->>'cashierId'=p_filters->>'cashier') and (coalesce(p_filters->>'date','')='' or envelope->>'serviceDate'=p_filters->>'date') and (coalesce(p_filters->>'transaction','')='' or transaction_id::text=p_filters->>'transaction') and coalesce(p_filters->>'status','')<>'closed' and (coalesce(p_filters->>'issue','')='' or p_filters->>'issue'='ingestion_conflict') order by recorded_at desc limit 100)c),'[]'),
 'terminals',coalesce((select jsonb_agg(jsonb_build_object('terminalId',t.terminal_id,'epoch',t.epoch,'key',t.terminal_key,'enabled',t.enabled,'suspended',coalesce(c.suspended,false),'revoked',coalesce(c.revoked,false),
 'lastContact',r.received_at,'lastReported',r.body->'status','sequence',r.terminal_sequence,'stale',r.received_at is null or r.received_at<now()-interval '2 minutes'))
 from public.pos_offline_terminals t left join public.pos_offline_controls c using(terminal_id,epoch)
 left join lateral(select * from public.pos_offline_terminal_reports r where r.terminal_id=t.terminal_id and r.epoch=t.epoch order by received_at desc limit 1)r on true),'[]'),
 'allocations',coalesce((select jsonb_agg(jsonb_build_object('allocationId',a.id,'terminalId',a.terminal_id,'epoch',a.epoch,'resourceId',ar.portion_type_id,'date',a.service_date,'expiresAt',a.expires_at,'state',a.state,
 'funded',ar.quantity_held,'settled',coalesce(s.quantity,0),'returned',coalesce(t.quantity,0),'outstandingHold',ar.quantity_held-coalesce(s.quantity,0)-coalesce(t.quantity,0),
 'verifiedUnused',(select (x->>'quantity')::integer from public.pos_offline_closures c,lateral jsonb_array_elements(c.body->'unused')x where c.allocation_id=a.id and (x->>'resourceId')::bigint=ar.portion_type_id),
 'lastReportedLocalConsumed',ar.quantity_held-(select (x->>'remaining')::integer from public.pos_offline_terminal_reports r,lateral jsonb_array_elements(r.body->'allocations')x where r.id=(select id from public.pos_offline_terminal_reports r2 where r2.terminal_id=a.terminal_id and r2.epoch=a.epoch order by received_at desc limit 1) and x->>'allocationId'=a.id::text and (x->>'resourceId')::bigint=ar.portion_type_id)))
 from public.pos_offline_allocations a join public.pos_offline_allocation_resources ar on ar.allocation_id=a.id
 left join(select allocation_id,portion_type_id,sum(quantity)quantity from public.pos_offline_stock_settlements group by allocation_id,portion_type_id)s using(allocation_id,portion_type_id)
 left join public.pos_offline_stock_returns t using(allocation_id,portion_type_id)),'[]'),
 'closeAdjustments',coalesce((select jsonb_agg(jsonb_build_object('transactionId',a.transaction_id,'date',a.service_date,'originalSignedCash',s.expected_pos_cash_ugx,'originalExpectedCash',coalesce(s.expected_cash_ugx,s.expected_pos_cash_ugx),'verifiedAdjustmentsTotal',coalesce((select sum(z.cash_adjustment) from public.pos_offline_close_resolutions z where z.snapshot_id=s.id),0),'verifiedAdjustedExpectedCash',coalesce(s.expected_cash_ugx,s.expected_pos_cash_ugx)+coalesce((select sum(z.cash_adjustment) from public.pos_offline_close_resolutions z where z.snapshot_id=s.id),0),'cashAdjustment',a.cash_amount,
 'state',case when r.transaction_id is null then 'needs_review' else 'resolved_additively' end,'reviewer',r.reviewer_id,'reason',r.reason,'reviewedAt',r.created_at,'snapshot',s.snapshot))
 from public.pos_offline_close_adjustments a join public.daily_close_snapshots s on s.id=a.snapshot_id left join public.pos_offline_close_resolutions r using(transaction_id)),'[]'));
end;$$;

create function public.get_pos_offline_handover_status(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.role in('admin','manager','cashier','staff') and coalesce(u.banned_until,now())<=now()) then raise exception 'offline_staff_required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('terminalId',t.terminal_id,'epoch',t.epoch,'enabled',t.enabled,'lastContact',r.received_at,'pendingCount',r.body#>'{status,pending_count}',
 'stale',r.received_at is null or r.received_at<now()-interval '2 minutes','journalAccessibleFromThisDevice',false))
 from public.pos_offline_terminals t left join lateral(select * from public.pos_offline_terminal_reports r where r.terminal_id=t.terminal_id and r.epoch=t.epoch order by received_at desc limit 1)r on true),'[]');
end;$$;
create function public.lookup_pos_offline_transaction(p_actor uuid,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare i public.pos_offline_ingestions%rowtype;
begin
 perform public.get_pos_offline_handover_status(p_actor);
 select * into i from public.pos_offline_ingestions where transaction_id=p_id;
 if not found then return jsonb_build_object('known',false,'localStatus','unknown; the phone cannot inspect another terminal journal');end if;
 if p_actor::text<>i.envelope->>'cashierId' and not exists(select 1 from public.profiles where id=p_actor and role in('admin','manager')) then raise exception 'offline_record_access_denied';end if;
 return jsonb_build_object('known',true,'transactionId',i.transaction_id,'receiptId',i.receipt_id,'orderId',coalesce(i.order_id,(select order_id from public.pos_offline_approved_postings where transaction_id=i.transaction_id)),'state',i.acknowledgement->>'disposition');
end;$$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('enroll_manager_pos_terminal','fund_manager_pos_allocation','get_pos_offline_operations','get_pos_offline_handover_status','lookup_pos_offline_transaction') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end;$$;
commit;
