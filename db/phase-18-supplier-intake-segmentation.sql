begin;

-- Phase 18: supplier intake segmentation.
-- Purpose:
-- 1. Give side-input suppliers their own category instead of reusing supply suppliers.
-- 2. Keep ingredient suppliers from leaking into non-consumable receiving lists.
-- 3. Preserve mixed suppliers for vendors who truly serve multiple intake lanes.

alter table public.suppliers
  drop constraint if exists suppliers_supplier_type_chk;

alter table public.suppliers
  add constraint suppliers_supplier_type_chk check (
    supplier_type in ('protein', 'ingredient', 'supply', 'mixed')
  );

update public.suppliers as s
set supplier_type = 'ingredient'
where supplier_type = 'supply'
  and exists (
    select 1
    from public.procurement_receipts pr
    where pr.supplier_id = s.id
      and pr.intake_type = 'ingredient'
  )
  and not exists (
    select 1
    from public.procurement_receipts pr
    where pr.supplier_id = s.id
      and pr.intake_type in ('protein', 'supply')
  );

comment on column public.suppliers.supplier_type is
  'Operational supplier category: protein, ingredient, supply, or mixed when one vendor serves multiple intake lanes.';

commit;
