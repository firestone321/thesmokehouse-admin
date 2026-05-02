import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { getAnalyticsSeries } from "@/lib/analytics/queries";
import type { AnalyticsMetric, AnalyticsTimeframe } from "@/lib/analytics/types";
import { RequestValidationError, parseSearchParams } from "@/lib/validation/http";

const analyticsQueryInputSchema = z.object({
  metric: z.string().trim().min(1),
  timeframe: z.string().trim().min(1),
  from: z.string().trim().optional(),
  to: z.string().trim().optional()
});

const allowedMetrics = new Set<AnalyticsMetric>(["revenue", "orders"]);
const allowedTimeframes = new Set<string>(["today", "7d", "30d", "180d", "12m", "custom", "3m"]);

export async function GET(request: Request) {
  try {
    await requireApprovedAdminRole();

    const query = parseSearchParams(new URL(request.url), analyticsQueryInputSchema);
    if (!allowedMetrics.has(query.metric as AnalyticsMetric)) {
      throw new RequestValidationError("Invalid analytics metric.");
    }

    if (!allowedTimeframes.has(query.timeframe)) {
      throw new RequestValidationError("Invalid analytics timeframe.");
    }

    const timeframe = query.timeframe === "3m" ? "180d" : query.timeframe;
    const from = query.from ? query.from : undefined;
    const to = query.to ? query.to : undefined;

    if (timeframe === "custom" && (!from || !to)) {
      throw new RequestValidationError("Custom analytics ranges require both from and to dates.");
    }

    const series = await getAnalyticsSeries({
      metric: query.metric as AnalyticsMetric,
      timeframe: timeframe as AnalyticsTimeframe,
      from,
      to
    });

    return NextResponse.json({ ok: true, data: { series } });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to load analytics.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
