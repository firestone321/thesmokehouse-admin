"use client";

import { useState } from "react";
import { AnalyticsBarChart } from "@/components/dashboard/analytics-bar-chart";
import { OrdersCreatedDrilldown } from "@/components/reports/orders-created-drilldown";
import type { AnalyticsSeries, AnalyticsTimeframe } from "@/lib/analytics/types";
import { formatCurrency } from "@/lib/ops/utils";

const timeframeOptions: Array<{ value: AnalyticsTimeframe; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "custom", label: "Custom period" }
];

function getSeriesKey(timeframe: AnalyticsTimeframe, from: string, to: string) {
  return timeframe === "custom" ? `${timeframe}:${from}:${to}` : timeframe;
}

async function fetchSeries(metric: "revenue" | "orders", timeframe: AnalyticsTimeframe, from?: string, to?: string) {
  const params = new URLSearchParams({ metric, timeframe });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const response = await fetch(`/api/admin/analytics?${params.toString()}`, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: { series?: AnalyticsSeries }; message?: string } | null;
  if (!response.ok || !payload?.ok || !payload.data?.series) {
    throw new Error(payload?.message ?? "Unable to load this reporting period.");
  }
  return payload.data.series;
}

export function ReportsAnalytics({ initialRevenue, initialOrders }: { initialRevenue: AnalyticsSeries; initialOrders: AnalyticsSeries }) {
  const [revenue, setRevenue] = useState(initialRevenue);
  const [orders, setOrders] = useState(initialOrders);
  const [activeTimeframe, setActiveTimeframe] = useState<AnalyticsTimeframe>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadPeriod(timeframe: AnalyticsTimeframe, from?: string, to?: string) {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [nextRevenue, nextOrders] = await Promise.all([
        fetchSeries("revenue", timeframe, from, to),
        fetchSeries("orders", timeframe, from, to)
      ]);
      setRevenue(nextRevenue);
      setOrders(nextOrders);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load this reporting period.");
    } finally {
      setLoading(false);
    }
  }

  function handleTimeframeChange(timeframe: AnalyticsTimeframe) {
    setActiveTimeframe(timeframe);
    if (timeframe !== "custom") void loadPeriod(timeframe);
  }

  function handleCustomLoad() {
    if (!customFrom || !customTo) {
      setErrorMessage("Choose both start and end dates for the custom period.");
      return;
    }
    if (customFrom > customTo) {
      setErrorMessage("The custom period must start on or before the end date.");
      return;
    }
    void loadPeriod("custom", customFrom, customTo);
  }

  return (
    <>
      <section className="surface-card rounded-[28px] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Reporting period</p>
            <p className="mt-1 text-sm text-[#6B7280]">Both charts use the same date range and Kampala time zone.</p>
          </div>
          {loading ? <span className="text-sm font-semibold text-[#6B7280]">Loading…</span> : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {timeframeOptions.map((option) => (
            <button key={option.value} type="button" onClick={() => handleTimeframeChange(option.value)} className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${activeTimeframe === option.value ? "border-[#5E2519] bg-[#5E2519] text-white" : "border-[#E4E7EB] bg-white text-[#4B5563] hover:border-[#C9D1D8]"}`}>
              {option.label}
            </button>
          ))}
        </div>
        {activeTimeframe === "custom" ? (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4">
            <label className="flex flex-col gap-2 text-sm font-semibold">Start<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-[14px] border border-[#D9E0E6] bg-white px-3 py-2 font-normal" /></label>
            <label className="flex flex-col gap-2 text-sm font-semibold">End<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="rounded-[14px] border border-[#D9E0E6] bg-white px-3 py-2 font-normal" /></label>
            <button type="button" onClick={handleCustomLoad} disabled={loading} className="rounded-full bg-[#5E2519] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Load period</button>
          </div>
        ) : null}
        {errorMessage ? <p className="mt-3 rounded-[18px] border border-[#F7D2B1] bg-[#FFF9F2] px-4 py-3 text-sm text-[#8A3F16]">{errorMessage}</p> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="surface-card rounded-[32px] p-5"><div className="flex items-baseline justify-between gap-3"><div><p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Sales trend</p><h2 className="mt-2 text-xl font-semibold">Completed paid revenue</h2></div><p className="text-sm font-semibold">{revenue.range.label}</p></div><div className="mt-5 rounded-[22px] border border-[#E4E7EB] bg-white p-4"><AnalyticsBarChart buckets={revenue.buckets} formatValue={formatCurrency} /></div></section>
        <OrdersCreatedDrilldown key={getSeriesKey(activeTimeframe, customFrom, customTo)} buckets={orders.buckets} rangeLabel={orders.range.label} />
      </div>
    </>
  );
}
