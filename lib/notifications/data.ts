import "server-only";

import { canApproveOperationalChanges, type AdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

export interface AdminNotificationRecord {
  id: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
}

export async function getUnreadAdminNotifications(profileId: string, role: AdminRole) {
  if (profileId === "local-auth-bypass" || !canApproveOperationalChanges(role)) return [];

  const { data, error } = await createAdminSupabaseClient()
    .from("admin_notifications")
    .select("id,title,body,href,created_at")
    .eq("recipient_profile_id", profileId)
    .is("read_at", null)
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw new Error(`Unable to load notifications: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    href: row.href,
    createdAt: row.created_at
  })) satisfies AdminNotificationRecord[];
}
