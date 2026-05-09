begin;

-- Phase 50: single-use jti store for internal HMAC request tokens.
-- Defends against replay of captured admin/storefront tokens within their
-- 60-second validity window (PS-SEC-04). Both repos call the same consume
-- RPC; UUIDs prevent jti collisions across signer fleets.

create table if not exists public.internal_token_replay (
  jti text primary key,
  exp timestamptz not null
);

create index if not exists internal_token_replay_exp_idx
  on public.internal_token_replay (exp);

alter table public.internal_token_replay enable row level security;

create or replace function public.consume_internal_token_jti(p_jti text, p_exp timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_count integer;
begin
  delete from public.internal_token_replay
  where exp < now() - interval '5 minutes';

  insert into public.internal_token_replay (jti, exp)
  values (p_jti, p_exp)
  on conflict (jti) do nothing;

  get diagnostics v_inserted_count = ROW_COUNT;
  return v_inserted_count > 0;
end;
$$;

revoke execute on function public.consume_internal_token_jti(text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_internal_token_jti(text, timestamptz) to service_role;

commit;
