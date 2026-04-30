import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { getOrdersPageData } from "@/lib/ops/queries";

function parseLimit(value: string | null) {
  const parsed = Number(value ?? 50);

  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

export async function GET(request: Request) {
  try {
    await requireApprovedAdminRole();

    const url = new URL(request.url);
    const data = await getOrdersPageData({
      status: url.searchParams.get("status"),
      search: url.searchParams.get("search"),
      limit: parseLimit(url.searchParams.get("limit"))
    });

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load orders.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
