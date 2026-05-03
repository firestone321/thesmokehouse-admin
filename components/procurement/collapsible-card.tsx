import { ReactNode } from "react";

export function CollapsibleCard({
  eyebrow,
  title,
  count,
  collapsedMessage,
  children
}: {
  eyebrow: string;
  title: string;
  count?: number;
  collapsedMessage: string;
  children: ReactNode;
}) {
  return (
    <details className="surface-card rounded-[32px] p-5">
      <summary className="cursor-pointer list-none border-b border-[#EEF2F6] pb-4 outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#111418]/20">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">{eyebrow}</p>
            <h2 className="mt-2 text-xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#6B7280]">{collapsedMessage}</p>
          </div>
          <div className="flex items-center gap-2">
            {typeof count === "number" ? (
              <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold text-[#4B5563]">{count}</span>
            ) : null}
            <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#4B5563]">
              Tap to expand
            </span>
          </div>
        </div>
      </summary>

      <div className="mt-4 space-y-3">{children}</div>
    </details>
  );
}
