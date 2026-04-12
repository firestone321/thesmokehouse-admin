"use client";

import { ReactNode, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminNavItems } from "@/lib/admin/nav";

const quickAccessLabels = new Set(["Dashboard", "Orders", "Menu", "Resupplies", "Suppliers", "Inventory", "Kitchen Queue"]);
const secondaryNavLabels = new Set(["Staff", "Settings"]);
const primaryNavItems = adminNavItems.filter((item) => !secondaryNavLabels.has(item.label));
const secondaryNavItems = adminNavItems.filter((item) => secondaryNavLabels.has(item.label));
const quickAccessItems = adminNavItems.filter((item) => quickAccessLabels.has(item.label));

function SidebarNav({
  items,
  compact = false,
  onNavigate
}: {
  items: typeof adminNavItems;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className={compact ? "space-y-1.5" : "space-y-1.5"}>
      {items.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            onClick={onNavigate}
            className={`block rounded-2xl border px-3 py-3 transition ${
              isActive
                ? "border-white/10 bg-white/[0.07] text-[#E6E8EB]"
                : "border-transparent bg-transparent text-[#CDD2D8] hover:border-white/5 hover:bg-white/[0.04] hover:text-[#E6E8EB]"
            }`}
          >
            <span className="text-sm font-semibold">{item.label}</span>
            <p className={`pt-1 text-[11px] leading-5 ${isActive ? "text-[#C8CFD8]" : "text-[#AEB6C2]"}`}>
              {item.description}
            </p>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminSidebar({
  userEmail,
  logoutSlot
}: {
  userEmail?: string | null;
  logoutSlot?: ReactNode;
}) {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      <div className="space-y-3 lg:hidden">
        <div className="wood-surface sticky top-3 z-30 rounded-[24px] border border-white/5 px-4 py-4 text-[#E6E8EB] shadow-[0_18px_36px_rgba(15,23,42,0.14)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl">
                <Image src="/icons/logo-bigger.jpg" alt="Firestone Country Smokehouse logo" fill className="object-cover" sizes="48px" priority />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.24em] text-[#AEB6C2]">Firestone Country Smokehouse</p>
                <p className="mt-1 truncate text-base font-semibold text-[#E6E8EB]">Kitchen Command</p>
              </div>
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

      <aside className="wood-surface hidden flex h-screen flex-col overflow-hidden rounded-[28px] border border-white/5 p-4 text-[#E6E8EB] shadow-[0_18px_36px_rgba(15,23,42,0.14)] lg:flex">
        <div className="sidebar-header shrink-0 border-b border-white/5 pb-5">
          <div className="brand-row flex items-center gap-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[20px]">
              <Image
                src="/icons/logo-bigger.jpg"
                alt="Firestone Country Smokehouse logo"
                fill
                className="object-cover"
                sizes="64px"
                priority
              />
            </div>
            <p className="min-w-0 text-[11px] uppercase tracking-[0.28em] text-[#AEB6C2]">Firestone Country Smokehouse</p>
          </div>
          <div className="command-info mt-4 w-full">
            <h1 className="text-xl font-semibold text-[#E6E8EB]">Kitchen Command</h1>
            <div className="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#AEB6C2]">
              <span className="h-2 w-2 rounded-full bg-[#2E7D32]" />
              Lunch service live
            </div>
            {userEmail ? <p className="mt-3 truncate text-sm text-[#CDD2D8]">{userEmail}</p> : null}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto py-4">
          <SidebarNav items={primaryNavItems} />
        </div>

        <div className="shrink-0 border-t border-white/10 pt-4">
          <SidebarNav items={secondaryNavItems} />
          {logoutSlot ? <div className="pt-4">{logoutSlot}</div> : null}
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
          <div className="wood-surface fixed inset-y-0 right-0 z-50 flex h-screen w-[min(88vw,340px)] flex-col overflow-hidden border-l border-white/10 px-4 py-5 text-[#E6E8EB] shadow-[-20px_0_48px_rgba(15,23,42,0.28)]">
            <div className="shrink-0 border-b border-white/5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[18px]">
                    <Image src="/icons/logo-bigger.jpg" alt="Firestone Country Smokehouse logo" fill className="object-cover" sizes="56px" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-[#AEB6C2]">Navigation</p>
                    <h2 className="mt-2 text-lg font-semibold text-[#E6E8EB]">Service tools</h2>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(false)}
                  className="rounded-2xl border border-white/10 bg-[#2A2F35] px-3 py-2 text-sm font-semibold text-[#E6E8EB]"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto py-4">
              <SidebarNav items={primaryNavItems} compact onNavigate={() => setIsDrawerOpen(false)} />
            </div>

            <div className="shrink-0 border-t border-white/10 pt-4">
              <SidebarNav items={secondaryNavItems} compact onNavigate={() => setIsDrawerOpen(false)} />
              {logoutSlot ? <div className="pt-4">{logoutSlot}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
