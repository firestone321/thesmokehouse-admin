import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/server";

export interface StaffActivityRecord {
  id: number;
  actorEmail: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  orderId: number | null;
  summary: string;
  createdAt: string;
}

const STAFF_ACTIVITY_PAGE_SIZE = 30;

function normalizeActivityPage(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value ?? 1));
}

function mapStaffActivityRecord(row: {
  id: number | string;
  actor_email_snapshot: string;
  actor_role_snapshot: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  order_id: number | string | null;
  summary: string;
  created_at: string;
}): StaffActivityRecord {
  return {
    id: Number(row.id),
    actorEmail: row.actor_email_snapshot,
    actorRole: row.actor_role_snapshot,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    orderId: row.order_id === null ? null : Number(row.order_id),
    summary: row.summary,
    createdAt: row.created_at
  };
}

export async function getStaffActivityLogPage(pageValue?: number | null): Promise<{
  activity: StaffActivityRecord[];
  page: number;
  totalPages: number;
  total: number;
  hasNextPage: boolean;
}> {
  const supabase = createAdminSupabaseClient();
  const requestedPage = normalizeActivityPage(pageValue);
  const { count, error: countError } = await supabase
    .from("staff_activity_log")
    .select("id", { count: "exact", head: true });

  if (countError) throw new Error(`Unable to count staff activity: ${countError.message}`);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / STAFF_ACTIVITY_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * STAFF_ACTIVITY_PAGE_SIZE;
  const { data, error } = await supabase
    .from("staff_activity_log")
    .select("id,actor_email_snapshot,actor_role_snapshot,action,entity_type,entity_id,order_id,summary,created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + STAFF_ACTIVITY_PAGE_SIZE - 1);

  if (error) throw new Error(`Unable to load staff activity: ${error.message}`);

  return {
    activity: (data ?? []).map(mapStaffActivityRecord),
    page,
    totalPages,
    total,
    hasNextPage: page < totalPages
  };
}

export async function getStaffActivityLog(limit = 200): Promise<StaffActivityRecord[]> {
  const { data, error } = await createAdminSupabaseClient()
    .from("staff_activity_log")
    .select("id,actor_email_snapshot,actor_role_snapshot,action,entity_type,entity_id,order_id,summary,created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (error) throw new Error(`Unable to load staff activity: ${error.message}`);
  return (data ?? []).map(mapStaffActivityRecord);
}

export async function getStaffActivityForOrder(orderId: number): Promise<StaffActivityRecord[]> {
  const { data, error } = await createAdminSupabaseClient()
    .from("staff_activity_log")
    .select("id,actor_email_snapshot,actor_role_snapshot,action,entity_type,entity_id,order_id,summary,created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Unable to load order handling activity: ${error.message}`);
  return (data ?? []).map(mapStaffActivityRecord);
}
