import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    await requireApprovedAdminRole();
    const publicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim());
    if (!publicKey) {
      return NextResponse.json({ message: "Push alerts need VAPID configuration." }, { status: 503, headers });
    }
    return NextResponse.json({ publicKey }, { headers });
  } catch (error) {
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    const message = error instanceof AdminAuthorizationError ? error.message : "Unable to load notification configuration.";
    return NextResponse.json({ message }, { status, headers });
  }
}
