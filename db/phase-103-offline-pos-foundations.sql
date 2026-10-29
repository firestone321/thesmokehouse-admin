-- Phase 103: PREPARED ONLY. Do not apply without staging stock/reconciliation acceptance.
-- Additive Phase 3A terminal enrollment + physically funded allocation contract.
-- No offline order/tender ingestion or allocation release until Phase 3B.
begin;
create table public.pos_offline_terminals (
  terminal_id uuid not null, epoch uuid not null, terminal_key text not null,
  registered_by uuid not null references public.profiles(id),
  registered_at timestamptz not null default now(), enabled boolean not null default false,
  primary key(terminal_id,epoch),
  check(terminal_key ~ '^[A-Za-z0-9_-]{43}$')
);
create unique index pos_offline_one_enabled_epoch on public.pos_offline_terminals(terminal_id) where enabled;
create table public.pos_offline_allocations (
  id uuid primary key, terminal_id uuid not null, epoch uuid not null,
  catalog_version uuid not null unique, service_date date not null,
  expires_at timestamptz not null, funded_by uuid not null references public.profiles(id),
  funded_at timestamptz not null default now(), state text not null default 'funded' check(state in ('funded','reconciled')),
  items jsonb not null, budgets jsonb not null,
  foreign key(terminal_id,epoch) references public.pos_offline_terminals(terminal_id,epoch)
);
create unique index pos_offline_one_funded_allocation on public.pos_offline_allocations(terminal_id) where state='funded';
create table public.pos_offline_allocation_resources (
  allocation_id uuid not null references public.pos_offline_allocations(id),
  portion_type_id bigint not null references public.portion_types(id),
  quantity_held integer not null check(quantity_held>0),
  primary key(allocation_id,portion_type_id)
);
alter table public.pos_offline_terminals enable row level security;
alter table public.pos_offline_allocations enable row level security;
alter table public.pos_offline_allocation_resources enable row level security;
revoke all on public.pos_offline_terminals,public.pos_offline_allocations,public.pos_offline_allocation_resources from public,anon,authenticated,service_role;
grant select on public.pos_offline_terminals,public.pos_offline_allocations,public.pos_offline_allocation_resources to service_role;

create function public.register_pos_offline_terminal(p_terminal_id uuid,p_epoch uuid,p_terminal_key text,p_manager_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=p_manager_id and role in ('admin','manager')) then raise exception 'manager_required'; end if;
  if exists(select 1 from public.pos_offline_allocations where terminal_id=p_terminal_id and state='funded') then raise exception 'reconcile_terminal_before_replacement'; end if;
  -- No key replacement or epoch reuse. A restored terminal requires explicit fencing.
  insert into public.pos_offline_terminals(terminal_id,epoch,terminal_key,registered_by,enabled)
  values(p_terminal_id,p_epoch,p_terminal_key,p_manager_id,true);
end; $$;

create function public.fund_pos_offline_allocation(
 p_allocation_id uuid,p_terminal_id uuid,p_epoch uuid,p_catalog_version uuid,
 p_menu_item_ids bigint[],p_budgets jsonb,p_expires_at timestamptz,p_manager_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_today date := (now() at time zone 'Africa/Kampala')::date;
 v_items jsonb; v_budgets jsonb := '[]'::jsonb; v_requested jsonb; v_resource record;
 v_available integer; v_minimum integer; v_quantity integer;
 v_finished public.finished_stock%rowtype; v_daily public.daily_stock%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_manager_id and role in ('admin','manager')) then raise exception 'manager_required'; end if;
 perform 1 from public.pos_offline_terminals where terminal_id=p_terminal_id and epoch=p_epoch and enabled for update;
 if not found then raise exception 'terminal_not_registered'; end if;
 if exists(select 1 from public.pos_offline_allocations where terminal_id=p_terminal_id and state='funded') then raise exception 'reconcile_existing_allocation'; end if;
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
 -- Lock all resources before determining the 35% minimum; existing online holds are excluded.
 for v_resource in select (b->>'resourceId')::bigint id,(b->>'quantity')::integer requested
   from jsonb_array_elements(v_requested) b order by (b->>'resourceId')::bigint loop
   select * into v_finished from public.finished_stock where portion_type_id=v_resource.id for update;
   if not found or v_finished.current_quantity<=0 then raise exception 'insufficient_finished_stock'; end if;
   v_available:=v_finished.current_quantity;
   select * into v_daily from public.daily_stock where stock_date=v_today and portion_type_id=v_resource.id for update;
   if found then v_available:=least(v_available,v_daily.remaining_quantity); end if;
   if v_available<=0 then raise exception 'insufficient_daily_stock'; end if;
   v_minimum:=ceil(v_available::numeric*0.35)::integer;
   v_quantity:=coalesce(v_resource.requested,v_minimum);
   if v_quantity<v_minimum then raise exception 'allocation_minimum_35_percent'; end if;
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
 return p_allocation_id;
end; $$;

create function public.get_pos_offline_snapshot(p_terminal_id uuid,p_epoch uuid,p_terminal_key text,p_cashier_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_snapshot jsonb;
begin
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
   where p.id=p_cashier_id and p.role in ('admin','manager','cashier','staff')
   and (u.banned_until is null or u.banned_until<=now())) then raise exception 'cashier_not_authorized'; end if;
 select jsonb_build_object('terminalId',t.terminal_id,'epoch',t.epoch,'terminalKey',t.terminal_key,
   'allocationId',a.id,'catalogVersion',a.catalog_version,'serviceDate',a.service_date,
   'expiresAt',(extract(epoch from a.expires_at)*1000)::bigint,'items',a.items,'budgets',a.budgets)
 into v_snapshot from public.pos_offline_terminals t join public.pos_offline_allocations a
 on a.terminal_id=t.terminal_id and a.epoch=t.epoch
 where t.terminal_id=p_terminal_id and t.epoch=p_epoch and t.terminal_key=p_terminal_key and t.enabled
 and a.state='funded' and a.expires_at>now() and a.service_date=(now() at time zone 'Africa/Kampala')::date;
 if v_snapshot is null then raise exception 'funded_allocation_required'; end if;
 return v_snapshot;
end; $$;
revoke all on function public.register_pos_offline_terminal(uuid,uuid,text,uuid),
 public.fund_pos_offline_allocation(uuid,uuid,uuid,uuid,bigint[],jsonb,timestamptz,uuid),
 public.get_pos_offline_snapshot(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.register_pos_offline_terminal(uuid,uuid,text,uuid),
 public.fund_pos_offline_allocation(uuid,uuid,uuid,uuid,bigint[],jsonb,timestamptz,uuid),
 public.get_pos_offline_snapshot(uuid,uuid,text,uuid) to service_role;
-- No automatic expiry/release: an offline terminal may already have consumed a hold.
-- Phase 3B must settle held resources without calling reserve_paid_order_stock a second time,
-- include holds in stock-reconciliation expectations, and preserve closed-day accounting.
commit;
