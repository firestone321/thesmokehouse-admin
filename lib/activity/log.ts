import "server-only";

import type { AdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

export type ActivityActor = { userId: string; email: string | null; role: AdminRole };

export async function recordStaffActivity(input: {
  actor: ActivityActor;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  orderId?: string | number | null;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  if (input.actor.userId === "local-auth-bypass") return;

  const { error } = await createAdminSupabaseClient().from("staff_activity_log").insert({
    actor_profile_id: input.actor.userId,
    actor_email_snapshot: input.actor.email ?? "Unknown staff account",
    actor_role_snapshot: input.actor.role,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId === null || input.entityId === undefined ? null : String(input.entityId),
    order_id: input.orderId === null || input.orderId === undefined ? null : Number(input.orderId),
    summary: input.summary,
    metadata: input.metadata ?? {}
  });

  if (error) throw new Error(`Unable to record staff activity: ${error.message}`);
}
