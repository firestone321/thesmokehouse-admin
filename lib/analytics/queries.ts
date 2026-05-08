import "server-only";
import { buildAnalyticsBuckets, buildAnalyticsDayValues, buildAnalyticsRange, parseLocalDateInput } from "@/lib/analytics/date-range";
import type { AnalyticsMetric, AnalyticsSeries, AnalyticsTimeframe } from "@/lib/analytics/types";
import { isLocalAuthBypassEnabled } from "@/lib/auth/local-bypass";
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";

type AnalyticsOrderRow = {
  status: string | null;
  payment_status: string | null;
  total_amount: number | null;
  created_at: string | null;
  completed_at: string | null;
  paid_at: string | null;
};

const analyticsSelection = "status,payment_status,total_amount,created_at,completed_at,paid_at";
const analyticsPageSize = 1_000;

async function createAnalyticsReadClient() {
  if (await isLocalAuthBypassEnabled()) {
    return createAdminSupabaseClient();
  }

  return createServerSupabaseClient();
}

async function fetchAnalyticsRows(input: {
  timeColumn: "created_at" | "completed_at" | "paid_at";
  startAt: string;
  endAt: string;
  revenueOnly?: boolean;
}): Promise<AnalyticsOrderRow[]> {
  const supabase = await createAnalyticsReadClient();
  const rows: AnalyticsOrderRow[] = [];
  let pageIndex = 0;

  while (true) {
    let query = supabase
      .from("orders")
      .select(analyticsSelection)
      .gte(input.timeColumn, input.startAt)
      .lt(input.timeColumn, input.endAt)
      .order(input.timeColumn, { ascending: true })
      .range(pageIndex * analyticsPageSize, (pageIndex + 1) * analyticsPageSize - 1);

    if (input.timeColumn === "completed_at") {
      query = query.not("completed_at", "is", null);
    }

    if (input.timeColumn === "paid_at") {
      query = query.not("paid_at", "is", null);
    }

    if (input.revenueOnly) {
      query = query.eq("payment_status", "paid");
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to load analytics rows: ${error.message}`);
    }

    const page = (data ?? []) as AnalyticsOrderRow[];
    rows.push(...page);

    if (page.length < analyticsPageSize) {
      break;
    }

    pageIndex += 1;
  }

  return rows;
}

function getMetricTitle(metric: AnalyticsMetric): string {
  return metric === "revenue" ? "Revenue" : "Total Orders";
}

function isRevenueEligible(row: AnalyticsOrderRow): boolean {
  return row.status === "completed" && row.payment_status === "paid" && Boolean(row.completed_at);
}

export async function getAnalyticsSeries(input: {
  metric: AnalyticsMetric;
  timeframe: AnalyticsTimeframe;
  now?: Date;
  from?: string;
  to?: string;
}): Promise<AnalyticsSeries> {
  const range = buildAnalyticsRange({
    timeframe: input.timeframe,
    now: input.now,
    from: parseLocalDateInput(input.from) ?? undefined,
    to: parseLocalDateInput(input.to) ?? undefined
  });
  const buckets = buildAnalyticsBuckets(range);
  const dayValues = buildAnalyticsDayValues(range);
  const rows =
    input.metric === "revenue"
      ? await fetchAnalyticsRows({
          timeColumn: "completed_at",
          startAt: range.startAt,
          endAt: range.endAt,
          revenueOnly: true
        })
      : await fetchAnalyticsRows({
          timeColumn: "created_at",
          startAt: range.startAt,
          endAt: range.endAt
        });

  let total = 0;
  let bucketIndex = 0;
  let dayIndex = 0;

  for (const row of rows) {
    const eventAt = input.metric === "revenue" ? row.completed_at : row.created_at;
    if (!eventAt) {
      continue;
    }

    if (input.metric === "revenue" && !isRevenueEligible(row)) {
      continue;
    }

    const numericValue = input.metric === "revenue" ? Math.max(0, row.total_amount ?? 0) : 1;
    const eventTimestamp = new Date(eventAt).getTime();

    while (bucketIndex < buckets.length && eventTimestamp >= new Date(buckets[bucketIndex].endAt).getTime()) {
      bucketIndex += 1;
    }

    if (bucketIndex >= buckets.length) {
      break;
    }

    const bucket = buckets[bucketIndex];
    const bucketStart = new Date(bucket.startAt).getTime();
    const bucketEnd = new Date(bucket.endAt).getTime();

    if (eventTimestamp >= bucketStart && eventTimestamp < bucketEnd) {
      bucket.value += numericValue;
      total += numericValue;
    }

    while (dayIndex < dayValues.length && eventTimestamp >= new Date(dayValues[dayIndex].endAt).getTime()) {
      dayIndex += 1;
    }

    if (dayIndex < dayValues.length) {
      const dayValue = dayValues[dayIndex];
      const dayStart = new Date(dayValue.startAt).getTime();
      const dayEnd = new Date(dayValue.endAt).getTime();

      if (eventTimestamp >= dayStart && eventTimestamp < dayEnd) {
        dayValue.value += numericValue;
      }
    }
  }

  return {
    metric: input.metric,
    title: getMetricTitle(input.metric),
    total,
    range,
    buckets,
    dayValues,
    generatedAt: new Date().toISOString()
  };
}

export async function getRevenueAnalyticsSeries(input: {
  timeframe: AnalyticsTimeframe;
  now?: Date;
  from?: string;
  to?: string;
}) {
  return getAnalyticsSeries({
    metric: "revenue",
    timeframe: input.timeframe,
    now: input.now,
    from: input.from,
    to: input.to
  });
}

export async function getRevenueTodayTotal(reference = new Date()) {
  const range = buildAnalyticsRange({
    timeframe: "today",
    now: reference
  });
  const rows = await fetchAnalyticsRows({
    timeColumn: "paid_at",
    startAt: range.startAt,
    endAt: range.endAt,
    revenueOnly: true
  });

  return rows.reduce((sum, row) => sum + Math.max(0, row.total_amount ?? 0), 0);
}
