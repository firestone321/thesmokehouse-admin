import {
  BUSINESS_TIME_ZONE,
  type AnalyticsBucket,
  type AnalyticsBucketUnit,
  type AnalyticsDayValue,
  type AnalyticsRange,
  type AnalyticsTimeframe,
  type LocalDateValue
} from "@/lib/analytics/types";

type LocalDateTimeValue = LocalDateValue & {
  hour: number;
  minute: number;
  second: number;
};

const partFormatterCache = new Map<string, Intl.DateTimeFormat>();
const labelFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartFormatter(timeZone: string) {
  const cacheKey = `parts:${timeZone}`;
  const cached = partFormatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  partFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function getLabelFormatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  const cacheKey = `label:${timeZone}:${JSON.stringify(options)}`;
  const cached = labelFormatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-UG", {
    timeZone,
    ...options
  });

  labelFormatterCache.set(cacheKey, formatter);
  return formatter;
}

export function parseLocalDateInput(value: string | null | undefined): LocalDateValue | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

export function formatLocalDateInput(value: LocalDateValue): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

export function compareLocalDates(left: LocalDateValue, right: LocalDateValue): number {
  return formatLocalDateInput(left).localeCompare(formatLocalDateInput(right));
}

export function addLocalDays(value: LocalDateValue, amount: number): LocalDateValue {
  const utcDate = new Date(Date.UTC(value.year, value.month - 1, value.day + amount));
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate()
  };
}

export function startOfLocalMonth(value: LocalDateValue): LocalDateValue {
  return { year: value.year, month: value.month, day: 1 };
}

export function addLocalMonths(value: LocalDateValue, amount: number): LocalDateValue {
  const utcDate = new Date(Date.UTC(value.year, value.month - 1 + amount, 1));
  const targetYear = utcDate.getUTCFullYear();
  const targetMonth = utcDate.getUTCMonth() + 1;
  const maxDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return {
    year: targetYear,
    month: targetMonth,
    day: Math.min(value.day, maxDay)
  };
}

function getTimeZoneDateTimeParts(date: Date, timeZone: string): LocalDateTimeValue {
  const formatter = getPartFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const entries = new Map(parts.map((part) => [part.type, part.value]));
  const hour = Number(entries.get("hour") ?? "0");

  return {
    year: Number(entries.get("year") ?? "0"),
    month: Number(entries.get("month") ?? "0"),
    day: Number(entries.get("day") ?? "0"),
    hour: hour === 24 ? 0 : hour,
    minute: Number(entries.get("minute") ?? "0"),
    second: Number(entries.get("second") ?? "0")
  };
}

export function getBusinessLocalDate(now = new Date()): LocalDateValue {
  const parts = getTimeZoneDateTimeParts(now, BUSINESS_TIME_ZONE);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function getTimeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
  const parts = getTimeZoneDateTimeParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedTimeToUtc(value: LocalDateTimeValue, timeZone: string): Date {
  const utcGuess = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  const firstOffset = getTimeZoneOffsetMilliseconds(new Date(utcGuess), timeZone);
  let adjusted = utcGuess - firstOffset;
  const secondOffset = getTimeZoneOffsetMilliseconds(new Date(adjusted), timeZone);

  if (firstOffset !== secondOffset) {
    adjusted = utcGuess - secondOffset;
  }

  return new Date(adjusted);
}

export function getStartOfBusinessDayUtc(value: LocalDateValue, timeZone = BUSINESS_TIME_ZONE): Date {
  return zonedTimeToUtc(
    {
      ...value,
      hour: 0,
      minute: 0,
      second: 0
    },
    timeZone
  );
}

export function formatBusinessDateLabel(value: LocalDateValue, timeZone = BUSINESS_TIME_ZONE): string {
  return getLabelFormatter(timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(getStartOfBusinessDayUtc(value, timeZone));
}

export function formatBusinessDateShort(value: LocalDateValue, timeZone = BUSINESS_TIME_ZONE): string {
  return getLabelFormatter(timeZone, {
    month: "short",
    day: "numeric"
  }).format(getStartOfBusinessDayUtc(value, timeZone));
}

function formatHourLabel(value: Date, timeZone = BUSINESS_TIME_ZONE) {
  return getLabelFormatter(timeZone, {
    hour: "numeric"
  }).format(value);
}

function formatMonthLabel(value: LocalDateValue, timeZone = BUSINESS_TIME_ZONE) {
  return getLabelFormatter(timeZone, {
    month: "short",
    year: "numeric"
  }).format(getStartOfBusinessDayUtc(value, timeZone));
}

function getRangeLabel(timeframe: AnalyticsTimeframe, startDate: LocalDateValue, endDateExclusive: LocalDateValue): string {
  if (timeframe === "today") return "Today";
  if (timeframe === "7d") return "Last 7 days";
  if (timeframe === "30d") return "Last 30 days";
  if (timeframe === "3m") return "Last 3 months";
  if (timeframe === "6m") return "Last 6 months";
  if (timeframe === "12m") return "Last 12 months";
  return `${formatBusinessDateShort(startDate)} to ${formatBusinessDateShort(addLocalDays(endDateExclusive, -1))}`;
}

function resolveBucketUnit(timeframe: AnalyticsTimeframe, startDate: LocalDateValue, endDateExclusive: LocalDateValue): AnalyticsBucketUnit {
  if (timeframe === "today") return "hour";
  if (timeframe === "7d" || timeframe === "30d") return "day";
  if (timeframe === "3m" || timeframe === "6m") return "week";
  if (timeframe === "12m") return "month";

  const spanDays =
    Math.floor((getStartOfBusinessDayUtc(endDateExclusive).getTime() - getStartOfBusinessDayUtc(startDate).getTime()) / 86_400_000) || 1;

  if (spanDays <= 2) return "hour";
  if (spanDays <= 62) return "day";
  if (spanDays <= 180) return "week";
  return "month";
}

export function buildAnalyticsRange(input: {
  timeframe: AnalyticsTimeframe;
  now?: Date;
  timeZone?: string;
  from?: LocalDateValue;
  to?: LocalDateValue;
}): AnalyticsRange {
  const timeZone = input.timeZone ?? BUSINESS_TIME_ZONE;
  const today = getBusinessLocalDate(input.now);
  const tomorrow = addLocalDays(today, 1);

  let startDate: LocalDateValue;
  let endDateExclusive: LocalDateValue;

  switch (input.timeframe) {
    case "today":
      startDate = today;
      endDateExclusive = tomorrow;
      break;
    case "7d":
      startDate = addLocalDays(today, -6);
      endDateExclusive = tomorrow;
      break;
    case "30d":
      startDate = addLocalDays(today, -29);
      endDateExclusive = tomorrow;
      break;
    case "3m":
      startDate = addLocalDays(today, -89);
      endDateExclusive = tomorrow;
      break;
    case "6m":
      startDate = addLocalDays(today, -179);
      endDateExclusive = tomorrow;
      break;
    case "12m":
      startDate = startOfLocalMonth(addLocalMonths(today, -11));
      endDateExclusive = startOfLocalMonth(addLocalMonths(today, 1));
      break;
    case "custom":
      if (!input.from || !input.to) {
        throw new Error("Custom analytics range requires both from and to dates.");
      }
      if (compareLocalDates(input.from, input.to) > 0) {
        throw new Error("Custom analytics range must start on or before the end date.");
      }
      startDate = input.from;
      endDateExclusive = addLocalDays(input.to, 1);
      break;
  }

  return {
    timeframe: input.timeframe,
    label: getRangeLabel(input.timeframe, startDate, endDateExclusive),
    startDate,
    endDateExclusive,
    startAt: getStartOfBusinessDayUtc(startDate, timeZone).toISOString(),
    endAt: getStartOfBusinessDayUtc(endDateExclusive, timeZone).toISOString(),
    bucketUnit: resolveBucketUnit(input.timeframe, startDate, endDateExclusive)
  };
}

export function buildAnalyticsBuckets(range: AnalyticsRange): AnalyticsBucket[] {
  const buckets: AnalyticsBucket[] = [];
  const endTimestamp = new Date(range.endAt).getTime();

  if (range.bucketUnit === "hour") {
    let cursor = new Date(range.startAt);

    while (cursor.getTime() < endTimestamp) {
      const next = new Date(cursor);
      next.setUTCHours(next.getUTCHours() + 1);

      buckets.push({
        key: cursor.toISOString(),
        label: formatHourLabel(cursor),
        shortLabel: formatHourLabel(cursor),
        startAt: cursor.toISOString(),
        endAt: next.toISOString(),
        value: 0
      });

      cursor = next;
    }

    return buckets;
  }

  let cursor = range.startDate;

  while (compareLocalDates(cursor, range.endDateExclusive) < 0) {
    let next = cursor;

    if (range.bucketUnit === "day") {
      next = addLocalDays(cursor, 1);
    } else if (range.bucketUnit === "week") {
      next = addLocalDays(cursor, 7);
    } else {
      next = addLocalMonths(cursor, 1);
    }

    const bucketStart = getStartOfBusinessDayUtc(cursor);
    const bucketEnd = getStartOfBusinessDayUtc(next);
    const lastBucketDay = addLocalDays(next, -1);
    const label =
      range.bucketUnit === "month"
        ? formatMonthLabel(cursor)
        : range.bucketUnit === "week"
          ? `${formatBusinessDateShort(cursor)} to ${formatBusinessDateShort(lastBucketDay)}`
          : formatBusinessDateLabel(cursor);

    buckets.push({
      key: bucketStart.toISOString(),
      label,
      shortLabel:
        range.bucketUnit === "month"
          ? formatMonthLabel(cursor).replace(/ \d{4}$/, "")
          : formatBusinessDateShort(cursor),
      startAt: bucketStart.toISOString(),
      endAt: bucketEnd.toISOString(),
      value: 0
    });

    cursor = next;
  }

  return buckets;
}

export function buildAnalyticsDayValues(range: AnalyticsRange): AnalyticsDayValue[] {
  const dayValues: AnalyticsDayValue[] = [];
  let cursor = range.startDate;

  while (compareLocalDates(cursor, range.endDateExclusive) < 0) {
    const next = addLocalDays(cursor, 1);
    const startAt = getStartOfBusinessDayUtc(cursor).toISOString();
    const endAt = getStartOfBusinessDayUtc(next).toISOString();

    dayValues.push({
      key: startAt,
      date: formatLocalDateInput(cursor),
      label: formatBusinessDateLabel(cursor),
      startAt,
      endAt,
      value: 0
    });

    cursor = next;
  }

  return dayValues;
}
