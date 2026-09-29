begin;

-- Scoped combined/passenger counter sales for traveller SKUs. The booking and
-- check-in calls run in one database transaction, so payment, stock, and the
-- kitchen handoff commit together. Ordinary POS quantity limits stay at 20.
create or replace function public.create_pos_traveller_counter_sale(
  p_idempotency_key uuid,
  p_request_hash text,
  p_cashier_profile_id uuid,
  p_order_mode text,
  p_customer_name text,
  p_customer_phone text,
  p_bus_reference text,
  p_tender_type text,
  p_amount_received integer,
  p_payment_reference text,
  p_items jsonb
)
returns table (
  id bigint, order_number text, status text, payment_status text,
  total_amount integer, tender_type text, amount_received integer,
  change_given integer, promised_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_booking record;
begin
  select * into v_booking from public.create_pos_traveller_preorder(
    p_idempotency_key, p_request_hash, p_cashier_profile_id, p_order_mode,
    p_customer_name, p_customer_phone, p_bus_reference,
    now() + interval '1 second', true, p_tender_type,
    p_amount_received, p_payment_reference, p_items
  );
  if v_booking.id is null then raise exception 'traveller_counter_booking_missing'; end if;
  perform public.check_in_paid_pos_traveller_preorder(v_booking.id, p_cashier_profile_id);
  return query select o.id, o.order_number, o.status, o.payment_status,
    o.total_amount, t.tender_type, t.amount_received, t.change_given, o.promised_at
  from public.orders o join public.pos_tenders t on t.order_id=o.id
  where o.id=v_booking.id;
end;
$$;

revoke all on function public.create_pos_traveller_counter_sale(uuid,text,uuid,text,text,text,text,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_pos_traveller_counter_sale(uuid,text,uuid,text,text,text,text,text,integer,text,jsonb) to service_role;
commit;
