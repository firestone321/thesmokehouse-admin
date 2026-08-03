"use server";

import { redirect } from "next/navigation";
import { canApproveOperationalChanges, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

export async function openAdminNotificationAction(formData: FormData) {
  const actor = await requireApprovedAdminRole();
  if (!canApproveOperationalChanges(actor.role) || actor.userId === "local-auth-bypass") {
    throw new Error("Only administrators and managers can open this notification.");
  }

  const notificationId = String(formData.get("notification_id") ?? "");
  const { data, error } = await createAdminSupabaseClient()
    .from("admin_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_profile_id", actor.userId)
    .select("href")
    .maybeSingle();

  if (error || !data) throw new Error("That notification could not be opened.");
  const href = typeof data.href === "string" && data.href.startsWith("/") && !data.href.startsWith("//")
    ? data.href
    : "/dashboard";
  redirect(href);
}
