begin;

create table if not exists public.staff_activity_log (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references public.profiles(id) on update cascade on delete set null,
  actor_email_snapshot text not null,
  actor_role_snapshot public.app_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  order_id bigint references public.orders(id) on update cascade on delete set null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint staff_activity_log_email_not_blank_chk check (btrim(actor_email_snapshot) <> ''),
  constraint staff_activity_log_action_not_blank_chk check (btrim(action) <> ''),
  constraint staff_activity_log_entity_not_blank_chk check (btrim(entity_type) <> ''),
  constraint staff_activity_log_summary_not_blank_chk check (btrim(summary) <> '')
);

create index if not exists staff_activity_log_created_idx
  on public.staff_activity_log (created_at desc, id desc);
create index if not exists staff_activity_log_actor_created_idx
  on public.staff_activity_log (actor_profile_id, created_at desc);
create index if not exists staff_activity_log_order_created_idx
  on public.staff_activity_log (order_id, created_at desc)
  where order_id is not null;
create index if not exists staff_activity_log_entity_created_idx
  on public.staff_activity_log (entity_type, entity_id, created_at desc);

alter table public.staff_activity_log enable row level security;
revoke all on public.staff_activity_log from public, anon, authenticated;
grant select on public.staff_activity_log to authenticated;
grant select, insert on public.staff_activity_log to service_role;
grant usage, select on sequence public.staff_activity_log_id_seq to service_role;

drop policy if exists "staff_activity_log_admin_manager_read" on public.staff_activity_log;
create policy "staff_activity_log_admin_manager_read"
on public.staff_activity_log
for select
to authenticated
using (public.has_role(array['admin'::public.app_role, 'manager'::public.app_role]));

create or replace function public.prevent_staff_activity_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'staff_activity_log_is_append_only';
end;
$$;

drop trigger if exists staff_activity_log_prevent_update_delete on public.staff_activity_log;
create trigger staff_activity_log_prevent_update_delete
before update or delete on public.staff_activity_log
for each row execute function public.prevent_staff_activity_log_mutation();

create table if not exists public.menu_price_change_requests (
  id uuid primary key default gen_random_uuid(),
  menu_item_id bigint not null references public.menu_items(id) on update cascade on delete restrict,
  requested_by_profile_id uuid not null references public.profiles(id) on update cascade on delete restrict,
  requester_email_snapshot text not null,
  current_price integer not null,
  proposed_price integer not null,
  status text not null default 'pending',
  reviewed_by_profile_id uuid references public.profiles(id) on update cascade on delete set null,
  reviewer_email_snapshot text,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint menu_price_change_requests_prices_chk check (
    current_price >= 0 and proposed_price >= 0 and current_price <> proposed_price
  ),
  constraint menu_price_change_requests_status_chk check (
    status in ('pending', 'approved', 'denied', 'superseded')
  ),
  constraint menu_price_change_requests_requester_email_chk check (btrim(requester_email_snapshot) <> ''),
  constraint menu_price_change_requests_review_state_chk check (
    (status = 'pending' and reviewed_at is null and reviewed_by_profile_id is null)
    or (status <> 'pending' and reviewed_at is not null)
  )
);

create unique index if not exists menu_price_change_requests_one_pending_item_idx
  on public.menu_price_change_requests (menu_item_id)
  where status = 'pending';
create index if not exists menu_price_change_requests_status_created_idx
  on public.menu_price_change_requests (status, created_at desc);
create index if not exists menu_price_change_requests_requester_created_idx
  on public.menu_price_change_requests (requested_by_profile_id, created_at desc);

alter table public.menu_price_change_requests enable row level security;
revoke all on public.menu_price_change_requests from public, anon, authenticated;
grant select on public.menu_price_change_requests to authenticated;
grant select, insert, update on public.menu_price_change_requests to service_role;

drop policy if exists "menu_price_requests_visible_to_requester_or_approver" on public.menu_price_change_requests;
create policy "menu_price_requests_visible_to_requester_or_approver"
on public.menu_price_change_requests
for select
to authenticated
using (
  requested_by_profile_id = auth.uid()
  or public.has_role(array['admin'::public.app_role, 'manager'::public.app_role])
);

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  href text not null,
  menu_price_change_request_id uuid references public.menu_price_change_requests(id) on update cascade on delete cascade,
  read_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint admin_notifications_text_chk check (
    btrim(notification_type) <> '' and btrim(title) <> '' and btrim(body) <> '' and href like '/%'
  ),
  unique (recipient_profile_id, notification_type, menu_price_change_request_id)
);

create index if not exists admin_notifications_recipient_unread_idx
  on public.admin_notifications (recipient_profile_id, created_at desc)
  where read_at is null;

alter table public.admin_notifications enable row level security;
revoke all on public.admin_notifications from public, anon, authenticated;
grant select on public.admin_notifications to authenticated;
grant select, insert, update on public.admin_notifications to service_role;

drop policy if exists "admin_notifications_recipient_read" on public.admin_notifications;
create policy "admin_notifications_recipient_read"
on public.admin_notifications
for select
to authenticated
using (
  recipient_profile_id = auth.uid()
  and public.has_role(array['admin'::public.app_role, 'manager'::public.app_role])
);

-- Menu writes must pass through the authenticated server actions. This closes
-- the direct PostgREST path that could otherwise bypass price approval.
revoke insert, update, delete on public.menu_items from anon, authenticated;
revoke insert, update, delete on public.menu_categories from anon, authenticated;
revoke insert, update, delete on public.menu_item_components from anon, authenticated;
revoke insert, update, delete on public.suppliers from anon, authenticated;

drop policy if exists "menu_items_admin_roles_write" on public.menu_items;
drop policy if exists "menu_categories_admin_roles_write" on public.menu_categories;
drop policy if exists "menu_item_components_admin_roles_write" on public.menu_item_components;
drop policy if exists "suppliers_admin_roles_write" on public.suppliers;

create or replace function public.request_menu_price_change(
  p_menu_item_id bigint,
  p_requested_by_profile_id uuid,
  p_proposed_price integer
)
returns public.menu_price_change_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_item public.menu_items%rowtype;
  v_existing public.menu_price_change_requests%rowtype;
  v_request public.menu_price_change_requests%rowtype;
begin
  select * into v_actor from public.profiles where id = p_requested_by_profile_id;
  if not found or v_actor.role not in ('staff'::public.app_role, 'chef'::public.app_role) then
    raise exception 'only_regular_staff_can_request_menu_price_changes';
  end if;

  if p_proposed_price is null or p_proposed_price < 0 then
    raise exception 'invalid_proposed_price';
  end if;

  select * into v_item from public.menu_items where id = p_menu_item_id for update;
  if not found then raise exception 'menu_item_not_found'; end if;
  if v_item.base_price = p_proposed_price then raise exception 'price_is_unchanged'; end if;

  select * into v_existing
  from public.menu_price_change_requests
  where menu_item_id = p_menu_item_id and status = 'pending'
  for update;

  if found then
    if v_existing.requested_by_profile_id = v_actor.id
      and v_existing.proposed_price = p_proposed_price
      and v_existing.current_price = v_item.base_price then
      return v_existing;
    end if;
    raise exception 'menu_price_request_already_pending';
  end if;

  insert into public.menu_price_change_requests (
    menu_item_id, requested_by_profile_id, requester_email_snapshot, current_price, proposed_price
  ) values (
    v_item.id, v_actor.id, v_actor.email, v_item.base_price, p_proposed_price
  ) returning * into v_request;

  insert into public.admin_notifications (
    recipient_profile_id, notification_type, title, body, href, menu_price_change_request_id
  )
  select
    p.id,
    'menu_price_change_requested',
    'Menu price needs approval',
    v_actor.email || ' suggested a new price for ' || v_item.name || '.',
    '/menu?edit=' || v_item.id::text || '&price_request=' || v_request.id::text,
    v_request.id
  from public.profiles p
  where p.role in ('admin'::public.app_role, 'manager'::public.app_role);

  insert into public.staff_activity_log (
    actor_profile_id, actor_email_snapshot, actor_role_snapshot, action,
    entity_type, entity_id, summary, metadata
  ) values (
    v_actor.id, v_actor.email, v_actor.role, 'menu.price_change_requested',
    'menu_item', v_item.id::text,
    v_actor.email || ' suggested a price change for ' || v_item.name || '.',
    jsonb_build_object('menu_item_name', v_item.name, 'current_price', v_item.base_price,
      'proposed_price', p_proposed_price, 'request_id', v_request.id)
  );

  return v_request;
end;
$$;

create or replace function public.review_menu_price_change(
  p_request_id uuid,
  p_reviewed_by_profile_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.menu_price_change_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_request public.menu_price_change_requests%rowtype;
  v_item public.menu_items%rowtype;
  v_status text;
begin
  select * into v_actor from public.profiles where id = p_reviewed_by_profile_id;
  if not found or v_actor.role not in ('admin'::public.app_role, 'manager'::public.app_role) then
    raise exception 'only_admins_and_managers_can_review_menu_prices';
  end if;
  if p_decision not in ('approve', 'deny') then raise exception 'invalid_price_review_decision'; end if;

  select * into v_request from public.menu_price_change_requests where id = p_request_id for update;
  if not found then raise exception 'menu_price_request_not_found'; end if;
  if v_request.status <> 'pending' then return v_request; end if;
  if v_request.requested_by_profile_id = v_actor.id then raise exception 'requester_cannot_review_own_price_request'; end if;

  select * into v_item from public.menu_items where id = v_request.menu_item_id for update;
  if not found then raise exception 'menu_item_not_found'; end if;

  if p_decision = 'approve' and v_item.base_price = v_request.current_price then
    update public.menu_items set base_price = v_request.proposed_price where id = v_item.id;
    v_status := 'approved';
  elsif p_decision = 'approve' then
    v_status := 'superseded';
  else
    v_status := 'denied';
  end if;

  update public.menu_price_change_requests
  set status = v_status,
      reviewed_by_profile_id = v_actor.id,
      reviewer_email_snapshot = v_actor.email,
      review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
      reviewed_at = now()
  where id = v_request.id
  returning * into v_request;

  update public.admin_notifications
  set resolved_at = now()
  where menu_price_change_request_id = v_request.id and resolved_at is null;

  insert into public.staff_activity_log (
    actor_profile_id, actor_email_snapshot, actor_role_snapshot, action,
    entity_type, entity_id, summary, metadata
  ) values (
    v_actor.id, v_actor.email, v_actor.role, 'menu.price_change_' || v_status,
    'menu_item', v_item.id::text,
    v_actor.email || ' ' || v_status || ' the suggested price for ' || v_item.name || '.',
    jsonb_build_object('menu_item_name', v_item.name, 'current_price', v_request.current_price,
      'proposed_price', v_request.proposed_price, 'request_id', v_request.id)
  );

  return v_request;
end;
$$;

revoke all on function public.request_menu_price_change(bigint, uuid, integer) from public, anon, authenticated;
grant execute on function public.request_menu_price_change(bigint, uuid, integer) to service_role;
revoke all on function public.review_menu_price_change(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_menu_price_change(uuid, uuid, text, text) to service_role;

commit;
