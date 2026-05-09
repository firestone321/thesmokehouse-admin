import "server-only";
import { buildAnalyticsBuckets, buildAnalyticsDayValues, buildAnalyticsRange, parseLocalDateInput } from "@/lib/analytics/date-range";
import type { AnalyticsMetric, AnalyticsSeries, AnalyticsTimeframe } from "@/lib/analytics/types";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

type AnalyticsAggregateRow = {
  bucket_start: string;
  value: number | string | null;
};

async function fetchAnalyticsAggregates(input: {
  metric: AnalyticsMetric;
  grain: "hour" | "day";
  startAt: string;
  endAt: string;
}): Promise<Array<{ startAt: string; value: number }>> {
  const rpcName =
    input.metric === "revenue"
      ? "get_analytics_revenue_aggregated"
      : "get_analytics_orders_aggregated";

  const { data, error } = await createAdminSupabaseClient().rpc(rpcName, {
    p_start: input.startAt,
    p_end: input.endAt,
    p_grain: input.grain
  });

  if (error) {
    throw new Error(`Failed to load analytics aggregates: ${error.message}`);
  }

  return ((data ?? []) as AnalyticsAggregateRow[]).map((row) => ({
    startAt: row.bucket_start,
    value: Number(row.value ?? 0)
  }));
}

function getMetricTitle(metric: AnalyticsMetric): string {
  return metric === "revenue" ? "Revenue" : "Total Orders";
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

  const aggregates = await fetchAnalyticsAggregates({
    metric: input.metric,
    grain: range.bucketUnit === "hour" ? "hour" : "day",
    startAt: range.startAt,
    endAt: range.endAt
  });

  let total = 0;
  let bucketIndex = 0;
  let dayIndex = 0;

  for (const aggregate of aggregates) {
    const eventTimestamp = new Date(aggregate.startAt).getTime();
    const numericValue = aggregate.value;

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

  const { data, error } = await createAdminSupabaseClient().rpc("get_revenue_today_total", {
    p_start: range.startAt,
    p_end: range.endAt
  });

  if (error) {
    throw new Error(`Failed to load today's revenue total: ${error.message}`);
  }

  return Number(data ?? 0);
}
