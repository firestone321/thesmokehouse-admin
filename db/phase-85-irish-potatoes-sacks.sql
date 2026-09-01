begin;

-- Irish potatoes are received as whole, half, quarter, or multiple sacks.
-- Never relabel an existing kilogram balance or history as sacks.
do $$
declare
  v_irish public.raw_materials%rowtype;
begin
  select *
  into v_irish
  from public.raw_materials
  where lower(name) = 'irish potatoes'
  for update;

  if not found then
    insert into public.raw_materials (name, category, unit_name, reorder_threshold)
    values ('Irish potatoes', 'edible', 'sacks', 0);
  elsif v_irish.unit_name = 'sacks' then
    null;
  elsif v_irish.unit_name = 'kg' then
    if v_irish.current_quantity <> 0
       or exists (select 1 from public.raw_material_purchases where raw_material_id = v_irish.id)
       or exists (select 1 from public.raw_material_movements where raw_material_id = v_irish.id)
    then
      raise exception 'irish_potatoes_unit_change_requires_history_decision';
    end if;

    update public.raw_materials
    set unit_name = 'sacks', updated_at = now()
    where id = v_irish.id;
  else
    raise exception 'irish_potatoes_unit_unexpected: %', v_irish.unit_name;
  end if;
end;
$$;

commit;
