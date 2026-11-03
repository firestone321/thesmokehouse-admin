begin;
create table public.pos_offline_grant_issuances(
 grant_id uuid primary key,cashier_id uuid not null references public.profiles(id),
 allocation_id uuid not null references public.pos_offline_allocations(id),terminal_id uuid not null,epoch uuid not null,
 signer_key_id text not null,grant_body jsonb not null,issued_at timestamptz not null default now(),
 foreign key(terminal_id,epoch) references public.pos_offline_terminals(terminal_id,epoch));
alter table public.pos_offline_grant_issuances enable row level security;
revoke all on public.pos_offline_grant_issuances from public,anon,authenticated,service_role;
grant select on public.pos_offline_grant_issuances to service_role;
create trigger immutable_grant_issuance before update or delete on public.pos_offline_grant_issuances for each row execute function public.pos_offline_immutable_evidence();
create function public.record_pos_offline_grant_issuance(p_grant jsonb,p_key_id text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid:=(p_grant->>'grantId')::uuid;
begin
 if p_key_id is null or p_key_id!~'^[A-Za-z0-9_-]{43}$' or not exists(
 select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=(p_grant->>'cashierId')::uuid and p.role in('admin','manager','cashier','staff') and coalesce(u.banned_until,now())<=now())
 then raise exception 'offline_active_cashier_and_signer_required';end if;
 if not exists(select 1 from public.pos_offline_allocations a join public.pos_offline_terminals t using(terminal_id,epoch)
 where a.id=(p_grant->>'allocationId')::uuid and a.terminal_id=(p_grant->>'terminalId')::uuid and a.epoch=(p_grant->>'epoch')::uuid and t.enabled
 and a.items=p_grant->'items' and a.budgets=p_grant->'budgets' and a.catalog_version=(p_grant->>'catalogVersion')::uuid
 and a.service_date=(p_grant->>'serviceDate')::date and a.expires_at>now() and a.state='funded')
 or exists(select 1 from public.pos_offline_controls where terminal_id=(p_grant->>'terminalId')::uuid and epoch=(p_grant->>'epoch')::uuid and (suspended or revoked))
 then raise exception 'offline_funded_active_allocation_required';end if;
 insert into public.pos_offline_grant_issuances(grant_id,cashier_id,allocation_id,terminal_id,epoch,signer_key_id,grant_body)
 values(v_id,(p_grant->>'cashierId')::uuid,(p_grant->>'allocationId')::uuid,(p_grant->>'terminalId')::uuid,(p_grant->>'epoch')::uuid,p_key_id,p_grant)
 on conflict(grant_id) do nothing;
 if not exists(select 1 from public.pos_offline_grant_issuances where grant_id=v_id and grant_body=p_grant and signer_key_id=p_key_id) then raise exception 'offline_grant_identity_conflict';end if;
 return v_id;
end;$$;
create function public.guard_offline_funded_catalog_delete() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.pos_offline_allocations a,lateral jsonb_array_elements(a.items) i where a.state='funded' and (i->>'menuItemId')::bigint=old.id)
 then raise exception 'offline_funded_catalog_use_deactivation';end if;
 return old;
end;$$;
create trigger offline_funded_catalog_delete_guard before delete on public.menu_items for each row execute function public.guard_offline_funded_catalog_delete();
revoke all on function public.record_pos_offline_grant_issuance(jsonb,text),public.guard_offline_funded_catalog_delete() from public,anon,authenticated;
grant execute on function public.record_pos_offline_grant_issuance(jsonb,text) to service_role;

alter table public.pos_offline_terminals add column journal_id uuid;
create function public.enroll_bound_pos_offline_terminal(p_terminal uuid,p_epoch uuid,p_key text,p_journal uuid,p_manager uuid,p_reason text,p_decision uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 perform pg_advisory_xact_lock(hashtextextended('managed-offline-terminal',112));
 if exists(select 1 from public.pos_offline_terminals where enabled and journal_id is not null) then raise exception 'offline_initial_single_windows_terminal_policy';end if;
 if p_journal is null or exists(select 1 from public.pos_offline_terminals where terminal_key=p_key) then raise exception 'offline_fresh_journal_and_key_required';end if;
 perform public.register_pos_offline_terminal(p_terminal,p_epoch,p_key,p_manager);
 update public.pos_offline_terminals set journal_id=p_journal where terminal_id=p_terminal and epoch=p_epoch;
 r:=jsonb_build_object('terminalId',p_terminal,'epoch',p_epoch,'terminalKey',p_key,'journalId',p_journal);
 insert into public.pos_offline_decisions values(p_decision,null,p_terminal,p_epoch,'enroll_bound',p_manager,p_reason,r,now());return r;
end;$$;
create function public.bind_existing_pos_offline_journal(p_terminal uuid,p_epoch uuid,p_key text,p_journal uuid,p_sequence bigint,p_legacy_upgrade boolean,p_manager uuid,p_reason text,p_decision uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t public.pos_offline_terminals%rowtype;known bigint;r jsonb;
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 perform pg_advisory_xact_lock(hashtextextended('managed-offline-terminal',112));
 select * into t from public.pos_offline_terminals where terminal_id=p_terminal and epoch=p_epoch for update;
 if not found or not t.enabled or t.terminal_key<>p_key or p_journal is null then raise exception 'offline_original_active_terminal_required';end if;
 if t.journal_id is not null and t.journal_id<>p_journal then raise exception 'offline_journal_replacement_requires_fencing';end if;
 if exists(select 1 from public.pos_offline_terminals where enabled and journal_id is not null and (terminal_id,epoch)<>(p_terminal,p_epoch)) then raise exception 'offline_initial_single_windows_terminal_policy';end if;
 known:=greatest(coalesce((select max(terminal_sequence) from public.pos_offline_ingestions where terminal_id=p_terminal and epoch=p_epoch),0),coalesce((select max(terminal_sequence) from public.pos_offline_terminal_reports where terminal_id=p_terminal and epoch=p_epoch),0));
 if p_sequence<known or (t.journal_id is null and not p_legacy_upgrade and exists(select 1 from public.pos_offline_allocations where terminal_id=p_terminal and epoch=p_epoch)) then raise exception 'offline_original_journal_or_supervised_recovery_required';end if;
 update public.pos_offline_terminals set journal_id=p_journal where terminal_id=p_terminal and epoch=p_epoch;
 r:=jsonb_build_object('terminalId',p_terminal,'epoch',p_epoch,'journalId',p_journal,'sequence',p_sequence);
 insert into public.pos_offline_decisions values(p_decision,null,p_terminal,p_epoch,'bind_original_journal',p_manager,p_reason,r,now());return r;
end;$$;
create function public.get_pos_offline_journal_binding(p_terminal uuid,p_epoch uuid,p_key text) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('journalId',t.journal_id,'managerId',t.registered_by,'minimumSequence',
 greatest(coalesce((select max(terminal_sequence) from public.pos_offline_ingestions where terminal_id=p_terminal and epoch=p_epoch),0),coalesce((select max(terminal_sequence) from public.pos_offline_terminal_reports where terminal_id=p_terminal and epoch=p_epoch),0)))
 from public.pos_offline_terminals t where t.terminal_id=p_terminal and t.epoch=p_epoch and t.terminal_key=p_key and t.enabled;
$$;
revoke all on function public.enroll_bound_pos_offline_terminal(uuid,uuid,text,uuid,uuid,text,uuid),public.bind_existing_pos_offline_journal(uuid,uuid,text,uuid,bigint,boolean,uuid,text,uuid),public.get_pos_offline_journal_binding(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.enroll_bound_pos_offline_terminal(uuid,uuid,text,uuid,uuid,text,uuid),public.bind_existing_pos_offline_journal(uuid,uuid,text,uuid,bigint,boolean,uuid,text,uuid),public.get_pos_offline_journal_binding(uuid,uuid,text) to service_role;

commit;
