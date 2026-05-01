import { NextResponse } from "next/server";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { adminOrdersQuerySchema } from "@/lib/schemas/admin";
import { getOrdersPageData } from "@/lib/ops/queries";
import { RequestValidationError, parseSearchParams } from "@/lib/validation/http";

export async function GET(request: Request) {
  try {
    await requireApprovedAdminRole();

    const url = new URL(request.url);
    const query = parseSearchParams(url, adminOrdersQuerySchema);
    const data = await getOrdersPageData({
      status: query.status,
      search: query.search,
      limit: query.limit
    });

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to load orders.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
