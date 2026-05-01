import { NextResponse } from "next/server";
import { processAdminPushDispatchQueue } from "@/lib/push/admin-paid-order-notifications";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    await requireApprovedAdminRole();
    const rateLimit = await enforceRateLimit(request, "admin-push-process", 8, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many requests. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const stats = await processAdminPushDispatchQueue({ limit: 5 });
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process admin push notifications.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
