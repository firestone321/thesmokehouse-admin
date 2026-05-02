import type { AnalyticsBucket } from "@/lib/analytics/types";

export function AnalyticsBarChart({
  buckets,
  formatValue,
  compact = false,
  selectedBucketKey,
  onSelectBucket
}: {
  buckets: AnalyticsBucket[];
  formatValue: (value: number) => string;
  compact?: boolean;
  selectedBucketKey?: string | null;
  onSelectBucket?: (bucket: AnalyticsBucket) => void;
}) {
  const maxValue = Math.max(...buckets.map((bucket) => bucket.value), 0);
  const labelStep = compact ? Number.POSITIVE_INFINITY : Math.max(1, Math.ceil(buckets.length / 6));

  return (
    <div className="w-full">
      <div className={`flex items-end gap-1.5 ${compact ? "h-14" : "h-64"}`}>
        {buckets.map((bucket) => {
          const ratio = maxValue > 0 ? bucket.value / maxValue : 0;
          const height = compact ? Math.max(ratio * 100, 8) : Math.max(ratio * 100, 4);
          const isSelected = selectedBucketKey === bucket.key;
          const barClassName = [
            "w-full rounded-t-[10px] transition-colors",
            onSelectBucket ? "cursor-pointer" : "cursor-default",
            isSelected ? "bg-[#5E2519] shadow-[0_0_0_2px_rgba(94,37,25,0.18)]" : "bg-[#8C4C34] hover:bg-[#6A3424]",
            compact ? "min-h-[6px]" : "min-h-[12px]"
          ].join(" ");

          return (
            <div key={bucket.key} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              {onSelectBucket ? (
                <button
                  type="button"
                  title={`${bucket.label}: ${formatValue(bucket.value)}`}
                  onClick={() => onSelectBucket(bucket)}
                  className={barClassName}
                  style={{ height: `${height}%` }}
                />
              ) : (
                <div
                  title={`${bucket.label}: ${formatValue(bucket.value)}`}
                  className={barClassName}
                  style={{ height: `${height}%` }}
                />
              )}
            </div>
          );
        })}
      </div>

      {compact ? null : (
        <div className="mt-3 flex items-start gap-1.5">
          {buckets.map((bucket, index) => {
            const shouldShow = index % labelStep === 0 || index === buckets.length - 1;
            return (
              <div key={`${bucket.key}-label`} className="min-w-0 flex-1 text-center">
                <span className={`text-[11px] ${shouldShow ? "text-[#6B7280]" : "text-transparent"}`}>{bucket.shortLabel}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
