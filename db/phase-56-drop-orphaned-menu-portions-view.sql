begin;

-- Phase 56: Rebuild v_menu_portions as SECURITY INVOKER.
-- The view was created with SECURITY DEFINER, allowing any caller (including anon) to
-- bypass RLS on portion_types, proteins, and packaging_types (all admin-only).
-- Recreating without SECURITY DEFINER restores correct RLS behaviour: only
-- admin/manager/staff authenticated users can query it. Storefront reads go through
-- get_storefront_menu (phase-39) which is service-role-only and unaffected.

drop view if exists public.v_menu_portions;

create view public.v_menu_portions
with (security_invoker = true)
as
select
  pt.id,
  pt.code,
  pt.name,
  pt.portion_label,
  p.name  as protein,
  pkg.name as packaging,
  pt.sort_order,
  pt.is_active
from public.portion_types pt
left join public.proteins p
  on p.id = pt.protein_id
left join public.packaging_types pkg
  on pkg.id = pt.packaging_type_id;

comment on view public.v_menu_portions is
  'Flattened portion-type reference for admin SQL queries. SECURITY INVOKER — RLS on underlying tables applies (admin/manager/staff only).';

commit;
