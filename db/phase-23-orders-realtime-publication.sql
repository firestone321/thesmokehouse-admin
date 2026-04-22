-- Add shared order tables to the Supabase Realtime publication so
-- the admin dashboard can receive live order inserts and updates.

begin;

do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception
    when duplicate_object then
      null;
    when undefined_object then
      null;
  end;

  begin
    alter publication supabase_realtime add table public.order_items;
  exception
    when duplicate_object then
      null;
    when undefined_object then
      null;
  end;
end
$$;

commit;
