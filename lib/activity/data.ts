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

export async function getStaffActivityLog(limit = 200): Promise<StaffActivityRecord[]> {
  const { data, error } = await createAdminSupabaseClient()
    .from("staff_activity_log")
    .select("id,actor_email_snapshot,actor_role_snapshot,action,entity_type,entity_id,order_id,summary,created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (error) throw new Error(`Unable to load staff activity: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    actorEmail: row.actor_email_snapshot,
    actorRole: row.actor_role_snapshot,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    orderId: row.order_id === null ? null : Number(row.order_id),
    summary: row.summary,
    createdAt: row.created_at
  }));
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
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    actorEmail: row.actor_email_snapshot,
    actorRole: row.actor_role_snapshot,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    orderId: row.order_id === null ? null : Number(row.order_id),
    summary: row.summary,
    createdAt: row.created_at
  }));
}
