begin;

-- Phase 8: ops incidents bootstrap.
-- Purpose:
-- 1. Capture any real issues that already exist at go-live.
-- 2. Put those issues into the same table the dashboard reads.
-- 3. Avoid creating fake incidents when there are no live issues to record.
--
-- How to use:
-- 1. Replace the empty incident_inputs CTE with real incidents only.
-- 2. Leave this file as-is if there are no current issues to log.

with incident_inputs as (
  select
    null::text as title,
    null::text as detail,
    null::text as severity,
    null::text as owner
  where false

  -- Example shape only. Replace with real values:
  -- union all select 'Beef ribs running low', 'Morning prep was lower than expected.', 'warning', 'Kitchen'
  -- union all select 'Packaging shortfall', 'Clamcraft boxes need urgent restock.', 'critical', 'Inventory'
)
insert into public.ops_incidents (
  title,
  detail,
  severity,
  status,
  owner
)
select
  ii.title,
  ii.detail,
  ii.severity,
  'open',
  ii.owner
from incident_inputs ii;

commit;
