export const BUSINESS_TIME_ZONE = "Africa/Kampala";

export type AnalyticsMetric = "revenue" | "orders";
export type AnalyticsTimeframe = "today" | "7d" | "30d" | "3m" | "6m" | "12m" | "custom";
export type AnalyticsBucketUnit = "hour" | "day" | "week" | "month";

export interface LocalDateValue {
  year: number;
  month: number;
  day: number;
}

export interface AnalyticsBucket {
  key: string;
  label: string;
  shortLabel: string;
  startAt: string;
  endAt: string;
  value: number;
}

export interface AnalyticsDayValue {
  key: string;
  date: string;
  label: string;
  startAt: string;
  endAt: string;
  value: number;
}

export interface AnalyticsRange {
  timeframe: AnalyticsTimeframe;
  label: string;
  startDate: LocalDateValue;
  endDateExclusive: LocalDateValue;
  startAt: string;
  endAt: string;
  bucketUnit: AnalyticsBucketUnit;
}

export interface AnalyticsSeries {
  metric: AnalyticsMetric;
  title: string;
  total: number;
  range: AnalyticsRange;
  buckets: AnalyticsBucket[];
  dayValues: AnalyticsDayValue[];
  generatedAt: string;
}
