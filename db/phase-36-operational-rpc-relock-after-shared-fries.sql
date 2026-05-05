begin;

-- Phase 36: re-apply operational RPC execute lockdown after later function replacements.
-- Purpose:
-- 1. Phase 35 replaced source-aware stock RPCs after the original Phase 32 lockdown
--    in some live rollout paths, which restored Postgres's default PUBLIC execute grant.
-- 2. Keep the effective live privilege state aligned with the app's service-role-only
--    server call paths.
-- 3. Include the current effective function signatures so this can be safely re-run.

revoke all on function public.get_daily_menu_stock(date) from public;
revoke all on function public.get_daily_menu_stock(date) from anon;
revoke all on function public.get_daily_menu_stock(date) from authenticated;
grant execute on function public.get_daily_menu_stock(date) to service_role;

revoke all on function public.add_order_note(bigint, text) from public;
revoke all on function public.add_order_note(bigint, text) from anon;
revoke all on function public.add_order_note(bigint, text) from authenticated;
grant execute on function public.add_order_note(bigint, text) to service_role;

revoke all on function public.apply_inventory_adjustment(bigint, numeric, text, text) from public;
revoke all on function public.apply_inventory_adjustment(bigint, numeric, text, text) from anon;
revoke all on function public.apply_inventory_adjustment(bigint, numeric, text, text) from authenticated;
grant execute on function public.apply_inventory_adjustment(bigint, numeric, text, text) to service_role;

revoke all on function public.process_procurement_receipt_to_finished_stock(bigint, bigint, integer, numeric, text) from public;
revoke all on function public.process_procurement_receipt_to_finished_stock(bigint, bigint, integer, numeric, text) from anon;
revoke all on function public.process_procurement_receipt_to_finished_stock(bigint, bigint, integer, numeric, text) from authenticated;
grant execute on function public.process_procurement_receipt_to_finished_stock(bigint, bigint, integer, numeric, text) to service_role;

revoke all on function public.process_whole_chicken_receipt_allocation(bigint, integer, integer, text) from public;
revoke all on function public.process_whole_chicken_receipt_allocation(bigint, integer, integer, text) from anon;
revoke all on function public.process_whole_chicken_receipt_allocation(bigint, integer, integer, text) from authenticated;
grant execute on function public.process_whole_chicken_receipt_allocation(bigint, integer, integer, text) to service_role;

revoke all on function public.record_procurement_receipt(text, text, bigint, bigint, text, text, date, date, text, text, text, numeric, text, numeric, text, integer, integer) from public;
revoke all on function public.record_procurement_receipt(text, text, bigint, bigint, text, text, date, date, text, text, text, numeric, text, numeric, text, integer, integer) from anon;
revoke all on function public.record_procurement_receipt(text, text, bigint, bigint, text, text, date, date, text, text, text, numeric, text, numeric, text, integer, integer) from authenticated;
grant execute on function public.record_procurement_receipt(text, text, bigint, bigint, text, text, date, date, text, text, text, numeric, text, numeric, text, integer, integer) to service_role;

revoke all on function public.mark_order_as_paid(bigint, text, text, text, text, text) from public;
revoke all on function public.mark_order_as_paid(bigint, text, text, text, text, text) from anon;
revoke all on function public.mark_order_as_paid(bigint, text, text, text, text, text) from authenticated;
grant execute on function public.mark_order_as_paid(bigint, text, text, text, text, text) to service_role;

revoke all on function public.transition_order_status(bigint, text, text) from public;
revoke all on function public.transition_order_status(bigint, text, text) from anon;
revoke all on function public.transition_order_status(bigint, text, text) from authenticated;
grant execute on function public.transition_order_status(bigint, text, text) to service_role;

revoke all on function public.reserve_paid_order_stock(bigint) from public;
revoke all on function public.reserve_paid_order_stock(bigint) from anon;
revoke all on function public.reserve_paid_order_stock(bigint) from authenticated;
grant execute on function public.reserve_paid_order_stock(bigint) to service_role;

revoke all on function public.release_reserved_order_stock(bigint) from public;
revoke all on function public.release_reserved_order_stock(bigint) from anon;
revoke all on function public.release_reserved_order_stock(bigint) from authenticated;
grant execute on function public.release_reserved_order_stock(bigint) to service_role;

revoke all on function public.finalize_reserved_order_sale(bigint) from public;
revoke all on function public.finalize_reserved_order_sale(bigint) from anon;
revoke all on function public.finalize_reserved_order_sale(bigint) from authenticated;
grant execute on function public.finalize_reserved_order_sale(bigint) to service_role;

commit;
