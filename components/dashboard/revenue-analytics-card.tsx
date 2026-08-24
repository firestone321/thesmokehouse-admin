"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsBarChart } from "@/components/dashboard/analytics-bar-chart";
import { formatCurrency, formatServiceDate } from "@/lib/ops/utils";
import type { AnalyticsBucket, AnalyticsSeries, AnalyticsTimeframe, LocalDateValue } from "@/lib/analytics/types";

const timeframeOptions: Array<{ value: AnalyticsTimeframe; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "That year" },
  { value: "custom", label: "Custom period" }
];

function getSeriesKey(timeframe: AnalyticsTimeframe, from?: string, to?: string) {
  if (timeframe !== "custom") {
    return timeframe;
  }

  return `custom:${from ?? ""}:${to ?? ""}`;
}

function getDefaultBucketKey(series: AnalyticsSeries) {
  const firstNonZeroBucket = series.buckets.find((bucket) => bucket.value > 0);
  return firstNonZeroBucket?.key ?? series.buckets[series.buckets.length - 1]?.key ?? null;
}

function formatLocalDateValue(value: LocalDateValue) {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function shiftLocalDateValue(value: LocalDateValue, amount: number) {
  const utcDate = new Date(Date.UTC(value.year, value.month - 1, value.day + amount));
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate()
  };
}

async function fetchRevenueSeries(input: { timeframe: AnalyticsTimeframe; from?: string; to?: string }) {
  const params = new URLSearchParams({
    metric: "revenue",
    timeframe: input.timeframe
  });

  if (input.from) {
    params.set("from", input.from);
  }

  if (input.to) {
    params.set("to", input.to);
  }

  const response = await fetch(`/api/admin/analytics?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: { series?: AnalyticsSeries }; message?: string }
    | null;

  if (!response.ok || !payload?.ok || !payload.data?.series) {
    throw new Error(payload?.message ?? "Failed to load revenue analytics.");
  }

  return payload.data.series;
}

export function RevenueAnalyticsCard({
  serviceDate,
  currentRevenue,
  initialSeries,
  refreshKey
}: {
  serviceDate: string;
  currentRevenue: number;
  initialSeries: AnalyticsSeries;
  refreshKey?: string;
}) {
  const cacheRef = useRef<Map<string, AnalyticsSeries>>(new Map([[getSeriesKey("today"), initialSeries]]));
  const [isOpen, setIsOpen] = useState(false);
  const [activeTimeframe, setActiveTimeframe] = useState<AnalyticsTimeframe>("today");
  const [activeSeries, setActiveSeries] = useState<AnalyticsSeries>(initialSeries);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(getDefaultBucketKey(initialSeries));
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const activeBucket = useMemo(
    () => activeSeries.buckets.find((bucket) => bucket.key === selectedBucketKey) ?? null,
    [activeSeries, selectedBucketKey]
  );

  const loadSeries = async (timeframe: AnalyticsTimeframe, from?: string, to?: string, forceRefresh = false) => {
    const key = getSeriesKey(timeframe, from, to);
    const cached = cacheRef.current.get(key);

    if (cached && !forceRefresh) {
      setActiveSeries(cached);
      setSelectedBucketKey((current) => {
        if (current && cached.buckets.some((bucket) => bucket.key === current)) {
          return current;
        }

        return getDefaultBucketKey(cached);
      });
      return cached;
    }

    setLoadingKey(key);

    try {
      const series = await fetchRevenueSeries({ timeframe, from, to });
      cacheRef.current.set(key, series);
      setActiveSeries(series);
      setSelectedBucketKey(getDefaultBucketKey(series));

      if (timeframe !== "custom") {
        setCustomFrom("");
        setCustomTo("");
      }

      return series;
    } finally {
      setLoadingKey((current) => (current === key ? null : current));
    }
  };

  useEffect(() => {
    setActiveSeries(initialSeries);
    setSelectedBucketKey(getDefaultBucketKey(initialSeries));
    cacheRef.current.set(getSeriesKey("today"), initialSeries);
  }, [initialSeries]);

  useEffect(() => {
    if (!refreshKey || activeTimeframe !== "today") {
      return;
    }

    void loadSeries("today", undefined, undefined, true).catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to refresh revenue analytics.");
    });
    // Intentionally tied to the dashboard snapshot revision so the today chart stays live.
  }, [activeTimeframe, refreshKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const openDetails = () => {
    setErrorMessage(null);
    setIsOpen(true);
  };

  const handleTimeframeChange = async (timeframe: AnalyticsTimeframe) => {
    setErrorMessage(null);
    setActiveTimeframe(timeframe);

    if (timeframe === "custom") {
      setCustomFrom(formatLocalDateValue(activeSeries.range.startDate));
      setCustomTo(formatLocalDateValue(shiftLocalDateValue(activeSeries.range.endDateExclusive, -1)));
      return;
    }

    await loadSeries(timeframe).catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load revenue analytics.");
    });
  };

  const handleLoadCustom = async () => {
    setErrorMessage(null);

    if (!customFrom || !customTo) {
      setErrorMessage("Choose both start and end dates for the custom period.");
      return;
    }

    if (customFrom > customTo) {
      setErrorMessage("The custom period must start on or before the end date.");
      return;
    }

    await loadSeries("custom", customFrom, customTo).catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load the custom period.");
    });
  };

  const handleBucketSelect = (bucket: AnalyticsBucket) => {
    setSelectedBucketKey(bucket.key);
  };

  return (
    <>
      <button type="button" onClick={openDetails} className="text-left">
        <article className="surface-card rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-[#D0D7DE]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">Revenue today</p>
              <p className="mt-3 text-3xl font-semibold text-[#111418]">{formatCurrency(currentRevenue)}</p>
              <p className="mt-2 text-sm leading-6 text-[#6B7280]">Only completed, paid orders are counted.</p>
            </div>
            <div className="rounded-full border border-[#E4E7EB] bg-[#F8FAFB] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4B5563]">
              Tap for details
            </div>
          </div>

          <div className="mt-4">
            <AnalyticsBarChart buckets={initialSeries.buckets} formatValue={formatCurrency} compact />
          </div>

          <p className="mt-3 text-xs leading-6 text-[#6B7280]">{formatServiceDate(serviceDate)}</p>
        </article>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#111418]/55 p-3 sm:items-center">
          <div aria-hidden="true" className="absolute inset-0" onClick={() => setIsOpen(false)} />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="revenue-analytics-title"
            className="relative z-10 w-full max-w-5xl overflow-hidden rounded-[28px] border border-[#DCE1E6] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.24)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[#EEF2F6] px-5 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Revenue</p>
                <h2 id="revenue-analytics-title" className="mt-2 text-2xl font-semibold text-[#111418]">
                  Revenue details
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                  Completed orders only, grouped by the selected Kampala service period.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-2 text-sm font-semibold text-[#111418]"
              >
                Close
              </button>
            </div>

            <div className="space-y-5 px-5 py-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <article className="rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Current total</p>
                  <p className="mt-2 text-3xl font-semibold text-[#111418]">{formatCurrency(activeSeries.total)}</p>
                  <p className="mt-2 text-sm leading-6 text-[#6B7280]">{activeSeries.range.label}</p>
                </article>
                <article className="rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Selected bucket</p>
                  <p className="mt-2 text-lg font-semibold text-[#111418]">{activeBucket?.label ?? "No bucket selected"}</p>
                  <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                    {activeBucket ? formatCurrency(activeBucket.value) : "Pick a bar to inspect its revenue."}
                  </p>
                </article>
                <article className="rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4 sm:col-span-2 xl:col-span-1">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Service day</p>
                  <p className="mt-2 text-lg font-semibold text-[#111418]">{formatServiceDate(serviceDate)}</p>
                  <p className="mt-2 text-sm leading-6 text-[#6B7280]">All amounts are filtered to completed orders only.</p>
                </article>
              </div>

              <div className="flex flex-wrap gap-2">
                {timeframeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => void handleTimeframeChange(option.value)}
                    className={[
                      "rounded-full border px-4 py-2 text-sm font-semibold transition",
                      activeTimeframe === option.value
                        ? "border-[#5E2519] bg-[#5E2519] text-white"
                        : "border-[#E4E7EB] bg-white text-[#4B5563] hover:border-[#C9D1D8]"
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {activeTimeframe === "custom" ? (
                <div className="flex flex-wrap items-end gap-3 rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
                  <label className="flex flex-col gap-2 text-sm font-semibold text-[#111418]">
                    Start
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(event) => setCustomFrom(event.target.value)}
                      className="rounded-[14px] border border-[#D9E0E6] bg-white px-3 py-2 text-sm font-normal text-[#111418]"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-semibold text-[#111418]">
                    End
                    <input
                      type="date"
                      value={customTo}
                      onChange={(event) => setCustomTo(event.target.value)}
                      className="rounded-[14px] border border-[#D9E0E6] bg-white px-3 py-2 text-sm font-normal text-[#111418]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleLoadCustom()}
                    disabled={loadingKey === getSeriesKey("custom", customFrom, customTo)}
                    className="rounded-full border border-[#5E2519] bg-[#5E2519] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loadingKey === getSeriesKey("custom", customFrom, customTo) ? "Loading..." : "Load period"}
                  </button>
                </div>
              ) : null}

              {errorMessage ? (
                <p className="rounded-[18px] border border-[#F7D2B1] bg-[#FFF9F2] px-4 py-3 text-sm leading-6 text-[#8A3F16]">
                  {errorMessage}
                </p>
              ) : null}

              <div className="rounded-[22px] border border-[#E4E7EB] bg-white px-4 py-4">
                <AnalyticsBarChart
                  buckets={activeSeries.buckets}
                  formatValue={formatCurrency}
                  selectedBucketKey={selectedBucketKey}
                  onSelectBucket={handleBucketSelect}
                />
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
