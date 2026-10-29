-- Forward-only: retain create_pos_sale and its atomic stock/tender/idempotency logic.
-- Apply before deploying the Phase 2 Admin POS. No live migration is run by this change.
begin;
create or replace function public.get_pos_sale_receipt(p_order_id bigint, p_cashier_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orderId', o.id, 'orderNumber', o.order_number, 'status', o.status,
    'totalAmount', o.total_amount, 'tenderType', t.tender_type,
    'amountReceived', t.amount_received, 'changeGiven', t.change_given,
    'canonicalReceipt', jsonb_build_object(
      'saleId', o.order_number, 'date', to_char(o.paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'items', (select jsonb_agg(jsonb_build_object('name', i.menu_item_name,
        'quantity', i.quantity, 'unitPrice', i.unit_price, 'total', i.line_total) order by i.id)
        from public.order_items i where i.order_id = o.id),
      'subtotal', o.total_amount, 'total', o.total_amount, 'paymentMethod', t.tender_type))
  from public.orders o join public.pos_tenders t on t.order_id = o.id
  where o.id = p_order_id and o.cashier_profile_id = p_cashier_profile_id
    and o.order_source = 'pos' and o.payment_status = 'paid';
$$;
create or replace function public.create_pos_sale_with_receipt(
  p_idempotency_key uuid, p_request_hash text, p_cashier_profile_id uuid,
  p_tender_type text, p_amount_received integer, p_payment_reference text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sale record; v_receipt jsonb;
begin
  select * into strict v_sale from public.create_pos_sale(
    p_idempotency_key, p_request_hash, p_cashier_profile_id, p_tender_type,
    p_amount_received, p_payment_reference, p_items);
  v_receipt := public.get_pos_sale_receipt(v_sale.id, p_cashier_profile_id);
  if v_receipt is null or jsonb_typeof(v_receipt #> '{canonicalReceipt,items}') <> 'array' then
    raise exception 'pos_canonical_receipt_unavailable';
  end if;
  return v_receipt;
end;
$$;
revoke all on function public.get_pos_sale_receipt(bigint, uuid) from public, anon, authenticated;
revoke all on function public.create_pos_sale_with_receipt(uuid,text,uuid,text,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.get_pos_sale_receipt(bigint, uuid) to service_role;
grant execute on function public.create_pos_sale_with_receipt(uuid,text,uuid,text,integer,text,jsonb) to service_role;
commit;
