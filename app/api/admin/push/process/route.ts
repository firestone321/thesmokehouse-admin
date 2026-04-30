import { NextResponse } from "next/server";
import { processAdminPushDispatchQueue } from "@/lib/push/admin-paid-order-notifications";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";

export async function POST() {
  try {
    await requireApprovedAdminRole();
    const stats = await processAdminPushDispatchQueue({ limit: 5 });
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process admin push notifications.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
