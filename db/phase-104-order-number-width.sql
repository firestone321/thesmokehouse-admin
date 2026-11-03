-- Forward only: no sequence reset or historical order changes.
begin;
create or replace function public.generate_order_number()
returns text language plpgsql as $$
declare v_next bigint;
begin
 v_next := nextval('public.order_number_seq');
 return lpad(v_next::text, greatest(3, length(v_next::text)), '0');
end;
$$;
commit;
