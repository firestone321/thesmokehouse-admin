import "server-only";

import { canApproveOperationalChanges, type AdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

export interface MenuPriceChangeRequestRecord {
  id: string;
  menuItemId: number;
  menuItemName: string;
  requesterEmail: string;
  currentPrice: number;
  proposedPrice: number;
  status: "pending" | "approved" | "denied" | "superseded";
  reviewerEmail: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export async function getMenuPriceChangeRequest(
  requestId: string | null,
  role: AdminRole
): Promise<MenuPriceChangeRequestRecord | null> {
  if (!requestId || !canApproveOperationalChanges(role)) return null;

  const { data, error } = await createAdminSupabaseClient()
    .from("menu_price_change_requests")
    .select(`
      id, menu_item_id, requester_email_snapshot, current_price, proposed_price,
      status, reviewer_email_snapshot, review_note, created_at, reviewed_at,
      menu_items (name)
    `)
    .eq("id", requestId)
    .maybeSingle();

  if (error) throw new Error(`Unable to load the suggested price: ${error.message}`);
  if (!data) return null;

  const menuItem = Array.isArray(data.menu_items) ? data.menu_items[0] : data.menu_items;
  return {
    id: data.id,
    menuItemId: Number(data.menu_item_id),
    menuItemName: menuItem?.name ?? "Menu item",
    requesterEmail: data.requester_email_snapshot,
    currentPrice: Number(data.current_price),
    proposedPrice: Number(data.proposed_price),
    status: data.status,
    reviewerEmail: data.reviewer_email_snapshot,
    reviewNote: data.review_note,
    createdAt: data.created_at,
    reviewedAt: data.reviewed_at
  };
}
