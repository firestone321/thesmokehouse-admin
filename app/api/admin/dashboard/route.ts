import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { getDashboardSnapshot } from "@/lib/ops/queries";

export async function GET() {
  try {
    await requireApprovedAdminRole();

    const snapshot = await getDashboardSnapshot();

    return NextResponse.json({ ok: true, data: { snapshot } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load dashboard.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
