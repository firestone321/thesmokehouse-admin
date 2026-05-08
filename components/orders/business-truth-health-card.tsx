import Link from "next/link";
import type { BusinessTruthHealthSection, BusinessTruthHealthSnapshot } from "@/lib/ops/types";

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Kampala"
  }).format(parsed);
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "none";
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  if (typeof value === "number") {
    return value.toLocaleString("en-UG");
  }

  if (typeof value === "string" && (value.endsWith("_at") || /^\d{4}-\d{2}-\d{2}T/.test(value))) {
    return formatDateTime(value);
  }

  return String(value);
}

function getSectionTone(section: BusinessTruthHealthSection) {
  if (section.severity === "critical") {
    return {
      badge: "bg-[#FDECEC] text-[#B42318]",
      border: "border-[#F4C7C3]",
      label: "Critical"
    };
  }

  if (section.severity === "warning") {
    return {
      badge: "bg-[#FFF7E8] text-[#B54708]",
      border: "border-[#F2D6A2]",
      label: "Warning"
    };
  }

  return {
    badge: "bg-[#EEF4FF] text-[#175CD3]",
    border: "border-[#C7D7FE]",
    label: "Info"
  };
}

function renderItem(item: Record<string, unknown>, index: number) {
  const orderId = typeof item.id === "number" ? item.id : typeof item.order_id === "number" ? item.order_id : null;
  const title =
    typeof item.order_number === "string"
      ? item.order_number
      : typeof item.portion_code === "string"
        ? item.portion_code
        : orderId
          ? `Order #${orderId}`
          : `Issue ${index + 1}`;

  const entries = Object.entries(item).filter(([key]) => !["id", "order_id", "order_number"].includes(key));

  return (
    <li key={`${title}-${index}`} className="rounded-2xl border border-[#E4E7EB] bg-[#FAFBFC] px-3 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-[#111418]">{title}</p>
        {orderId ? (
          <Link href={`/orders/${orderId}`} className="text-xs font-semibold text-[#B85C38]">
            Open order
          </Link>
        ) : null}
      </div>
      {entries.length > 0 ? (
        <dl className="mt-2 grid gap-2 text-xs text-[#6B7280] sm:grid-cols-2 xl:grid-cols-3">
          {entries.slice(0, 9).map(([key, value]) => (
            <div key={key}>
              <dt className="font-semibold uppercase tracking-[0.12em] text-[#9CA3AF]">{key.replace(/_/g, " ")}</dt>
              <dd className="mt-0.5 break-words">{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

export function BusinessTruthHealthCard({ snapshot }: { snapshot: BusinessTruthHealthSnapshot }) {
  const activeSections = snapshot.sections.filter((section) => section.count > 0);
  const healthy = snapshot.criticalCount === 0 && snapshot.warningCount === 0;

  return (
    <details className="surface-card group rounded-[32px] px-5 py-5">
      <summary className="flex cursor-pointer list-none flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-[3px] shrink-0 text-[#9CA3AF] transition-transform duration-200 group-open:rotate-90">
            ▶
          </span>
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Admin only</p>
            <h2 className="mt-2 text-xl font-semibold text-[#111418]">Business truth health</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B7280]">
              Read-only reconciliation for payment, stock, and recovery states. This panel is hidden from regular staff.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-2xl border border-[#E4E7EB] bg-white px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">Critical</p>
            <p className="text-xl font-semibold text-[#B42318]">{snapshot.criticalCount}</p>
          </div>
          <div className="rounded-2xl border border-[#E4E7EB] bg-white px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">Warning</p>
            <p className="text-xl font-semibold text-[#B54708]">{snapshot.warningCount}</p>
          </div>
          <div className="rounded-2xl border border-[#E4E7EB] bg-white px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">Checked</p>
            <p className="text-xs font-semibold text-[#111418]">{formatDateTime(snapshot.generatedAt)}</p>
          </div>
        </div>
      </summary>

      {healthy ? (
        <div className="mt-4 rounded-2xl border border-[#D7E8DA] bg-[#F4FBF5] px-4 py-3 text-sm font-medium text-[#166534]">
          No payment or stock truth issues detected in this snapshot.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {activeSections.map((section) => {
            const tone = getSectionTone(section);
            return (
              <section key={section.key} className={`rounded-[24px] border ${tone.border} bg-white px-4 py-4`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-[#111418]">{section.title}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${tone.badge}`}>
                        {tone.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[#6B7280]">{section.description}</p>
                  </div>
                  <p className="text-2xl font-semibold text-[#111418]">{section.count}</p>
                </div>

                {section.items.length > 0 ? (
                  <ul className="mt-3 space-y-2">{section.items.map(renderItem)}</ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </details>
  );
}
