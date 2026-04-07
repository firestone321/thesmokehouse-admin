"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { sidebarNavItems } from "@/lib/dashboard/mock-data";

const quickAccessLabels = new Set(["Dashboard", "Orders", "Inventory", "Kitchen Queue"]);

function SidebarNav({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className={compact ? "space-y-1.5" : "mt-4 space-y-1.5"}>
      {sidebarNavItems.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            onClick={onNavigate}
            className={`block rounded-2xl border px-3 py-3 transition ${
              isActive
                ? "border-white/10 bg-[#2A2F35] text-[#E6E8EB] shadow-[0_10px_20px_rgba(0,0,0,0.18)]"
                : "border-transparent bg-transparent text-[#CDD2D8] hover:bg-[#2A2F35] hover:text-[#E6E8EB]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{item.label}</span>
              {isActive ? (
                <span className="rounded-full bg-white/10 px-2 py-1 text-[9px] uppercase tracking-[0.18em] text-[#E6E8EB]">
                  Live
                </span>
              ) : null}
            </div>
            <p className="pt-1 text-[11px] leading-5 text-[#AEB6C2]">{item.description}</p>
          </Link>
        );
      })}
    </nav>
  );
}

function ShiftSnapshot() {
  return (
    <div className="rounded-3xl border border-white/8 bg-white/5 p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#AEB6C2]">Shift snapshot</p>
      <div className="mt-3 space-y-3 text-sm text-[#CDD2D8]">
        <div className="flex items-center justify-between gap-3">
          <span>Front counter</span>
          <span className="text-[#E6E8EB]">2 open tabs</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Pits online</span>
          <span className="text-[#E6E8EB]">3 of 3</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Hot hold</span>
          <span className="text-[#E6E8EB]">2 orders</span>
        </div>
      </div>
    </div>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const quickAccessItems = useMemo(
    () => sidebarNavItems.filter((item) => quickAccessLabels.has(item.label)),
    []
  );

  return (
    <>
      <div className="space-y-3 lg:hidden">
        <div className="wood-surface sticky top-3 z-30 rounded-[24px] border border-white/5 px-4 py-4 text-[#E6E8EB] shadow-[0_18px_36px_rgba(15,23,42,0.14)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#AEB6C2]">Smokehouse Ops</p>
              <p className="mt-1 truncate text-base font-semibold text-[#E6E8EB]">Kitchen Command</p>
            </div>
            <button
              type="button"
              aria-expanded={isDrawerOpen}
              aria-label="Open navigation menu"
              onClick={() => setIsDrawerOpen(true)}
              className="rounded-2xl border border-white/10 bg-[#2A2F35] px-3 py-2 text-sm font-semibold text-[#E6E8EB]"
            >
              Menu
            </button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {quickAccessItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "border-[#D0D7DE] bg-[#FFFFFF] text-[#111418]"
                    : "border-[#E4E7EB] bg-[#F8FAFB] text-[#6B7280]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <aside className="wood-surface hidden flex-col rounded-[28px] border border-white/5 p-4 text-[#E6E8EB] shadow-[0_18px_36px_rgba(15,23,42,0.14)] lg:sticky lg:top-5 lg:flex lg:h-[calc(100vh-2.5rem)]">
        <div className="pb-4">
          <p className="text-[11px] uppercase tracking-[0.28em] text-[#AEB6C2]">Smokehouse Ops</p>
          <h1 className="pt-2 text-xl font-semibold text-[#E6E8EB]">Kitchen Command</h1>
          <div className="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#AEB6C2]">
            <span className="h-2 w-2 rounded-full bg-[#2E7D32]" />
            Lunch service live
          </div>
        </div>

        <SidebarNav />
        <div className="mt-auto">
          <ShiftSnapshot />
        </div>
      </aside>

      {isDrawerOpen ? (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close navigation drawer"
            onClick={() => setIsDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-[#111418]/45 backdrop-blur-[2px]"
          />
          <div className="wood-surface fixed inset-y-0 right-0 z-50 flex w-[min(88vw,340px)] flex-col border-l border-white/10 px-4 py-5 text-[#E6E8EB] shadow-[-20px_0_48px_rgba(15,23,42,0.28)]">
            <div className="flex items-start justify-between gap-3 pb-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-[#AEB6C2]">Navigation</p>
                <h2 className="mt-2 text-lg font-semibold text-[#E6E8EB]">Service tools</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="rounded-2xl border border-white/10 bg-[#2A2F35] px-3 py-2 text-sm font-semibold text-[#E6E8EB]"
              >
                Close
              </button>
            </div>

            <SidebarNav compact onNavigate={() => setIsDrawerOpen(false)} />

            <div className="mt-auto pt-4">
              <ShiftSnapshot />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
