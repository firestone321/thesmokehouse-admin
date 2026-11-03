begin;
create function public.issue_pos_offline_recovery(p_id uuid,p_terminal uuid,p_epoch uuid,p_hash text,p_manager uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare seq bigint;r jsonb;
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 perform 1 from public.pos_offline_terminals where terminal_id=p_terminal and epoch=p_epoch and not enabled for update;
 if not found or not exists(select 1 from public.pos_offline_controls where terminal_id=p_terminal and epoch=p_epoch and revoked) then raise exception 'offline_original_epoch_must_be_fenced';end if;
 if p_hash!~'^[a-f0-9]{64}$' then raise exception 'offline_backup_hash_required';end if;
 seq:=greatest(coalesce((select max(terminal_sequence) from public.pos_offline_ingestions where terminal_id=p_terminal and epoch=p_epoch),0),
 coalesce((select max(terminal_sequence) from public.pos_offline_terminal_reports where terminal_id=p_terminal and epoch=p_epoch),0));
 insert into public.pos_offline_recovery_permits values(p_id,p_terminal,p_epoch,p_hash,seq,p_manager,p_reason,now());
 r:=jsonb_build_object('permitId',p_id,'terminalId',p_terminal,'epoch',p_epoch,'backupHash',p_hash,'minimumSequence',seq,'mode','evidence-only','fenced',true);
 insert into public.pos_offline_decisions values(p_id,null,p_terminal,p_epoch,'issue_recovery',p_manager,p_reason,r,now());return r;
end;$$;
create function public.import_pos_offline_recovery(p_permit uuid,p_envelope jsonb,p_signature text,p_hash text,p_grant jsonb,p_manager uuid,p_decision uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.pos_offline_recovery_permits%rowtype;r jsonb;
begin
 perform public.assert_pos_offline_manager(p_manager,'Import authenticated historical recovery evidence');
 select * into p from public.pos_offline_recovery_permits where id=p_permit;
 if not found or p.issued_at<now()-interval '24 hours' or p.terminal_id<>(p_envelope->>'terminalId')::uuid or p.epoch<>(p_envelope->>'epoch')::uuid then raise exception 'offline_recovery_permit_invalid';end if;
 perform 1 from public.pos_offline_terminals where terminal_id=p.terminal_id and epoch=p.epoch and not enabled for update;
 if not found or not exists(select 1 from public.pos_offline_controls where terminal_id=p.terminal_id and epoch=p.epoch and revoked) then raise exception 'offline_original_epoch_must_be_fenced';end if;
 r:=public.ingest_pos_offline_cash_sale(p_envelope,p_signature,p_hash,p_grant);
 insert into public.pos_offline_decisions values(p_decision,(p_envelope->>'transactionId')::uuid,p.terminal_id,p.epoch,'recovery_import',p_manager,'Import authenticated historical recovery evidence',jsonb_build_object('permitId',p.id,'acknowledgement',r,'newFinancialPosting',false),now());
 return r;
end;$$;
create function public.audit_pos_offline_key_rotation(p_id uuid,p_manager uuid,p_reason text,p_public_keys jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 if jsonb_typeof(p_public_keys) is distinct from 'array' or jsonb_array_length(p_public_keys) not between 1 and 64 or exists(
 select 1 from jsonb_array_elements(p_public_keys) k where k?'d' or k->>'kty' is distinct from 'OKP' or k->>'crv' is distinct from 'Ed25519' or k->>'x' is null or (k->>'x')!~'^[A-Za-z0-9_-]{43}$')
 then raise exception 'offline_public_ed25519_history_required';end if;
 insert into public.pos_offline_decisions values(p_id,null,null,null,'key_rotation_plan',p_manager,p_reason,jsonb_build_object('publicKeys',p_public_keys,'deploymentRequired',true),now());return p_id;
end;$$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('issue_pos_offline_recovery','import_pos_offline_recovery','audit_pos_offline_key_rotation') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end;$$;

create function public.review_pos_offline_conflict(p_case uuid,p_manager uuid,p_reason text,p_decision uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.pos_offline_conflict_evidence%rowtype;r jsonb;
begin
 perform public.assert_pos_offline_manager(p_manager,p_reason);
 select * into c from public.pos_offline_conflict_evidence where id=p_case;
 if not found then raise exception 'offline_conflict_evidence_required';end if;
 r:=jsonb_build_object('evidenceId',c.id,'payloadHash',c.payload_hash,'noFinancialEffects',true,'status','investigating_identity_conflict');
 insert into public.pos_offline_decisions values(p_decision,c.transaction_id,(c.envelope->>'terminalId')::uuid,(c.envelope->>'epoch')::uuid,'review_conflict',p_manager,p_reason,r,now());return r;
end;$$;
revoke all on function public.review_pos_offline_conflict(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.review_pos_offline_conflict(uuid,uuid,text,uuid) to service_role;

commit;
