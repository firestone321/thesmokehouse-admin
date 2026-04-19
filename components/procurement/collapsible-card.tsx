"use client";

import { ReactNode, useState } from "react";

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
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <section className="surface-card rounded-[32px] p-5">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        onClick={() => setIsCollapsed((currentValue) => !currentValue)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsCollapsed((currentValue) => !currentValue);
          }
        }}
        className="cursor-pointer border-b border-[#EEF2F6] pb-4 outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#111418]/20"
      >
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">{eyebrow}</p>
            <h2 className="mt-2 text-xl font-semibold">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {typeof count === "number" ? (
              <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold text-[#4B5563]">{count}</span>
            ) : null}
            <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#4B5563]">
              {isCollapsed ? "collapsed" : "open"}
            </span>
          </div>
        </div>
      </div>

      {isCollapsed ? (
        <div className="mt-4 rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
          {collapsedMessage}
        </div>
      ) : (
        <div className="mt-4 space-y-3">{children}</div>
      )}
    </section>
  );
}
