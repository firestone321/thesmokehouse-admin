"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sidebarNavItems } from "@/lib/dashboard/mock-data";

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="wood-surface surface-card flex flex-col rounded-4xl p-5 text-sand lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:p-6">
      <div className="border-b border-white/10 pb-5">
        <p className="text-xs uppercase tracking-[0.28em] text-copper/80">Smokehouse</p>
        <h1 className="font-display pt-2 text-3xl text-parchment">Admin Control Room</h1>
        <p className="pt-3 text-sm leading-6 text-sand/78">
          Built for dependable kitchen flow. Pending orders stay visibly separate from prep-ready work.
        </p>
      </div>

      <nav className="mt-6 space-y-2">
        {sidebarNavItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`block rounded-2xl border px-4 py-3 transition ${
                isActive
                  ? "border-copper/55 bg-white/12 text-parchment shadow-panel"
                  : "border-white/6 bg-white/0 text-sand/78 hover:border-white/10 hover:bg-white/6 hover:text-parchment"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{item.label}</span>
                {isActive ? (
                  <span className="rounded-full bg-copper/20 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-copper">
                    Live
                  </span>
                ) : null}
              </div>
              <p className="pt-1 text-xs leading-5 text-inherit/80">{item.description}</p>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-3xl border border-copper/25 bg-white/8 p-4">
        <p className="text-xs uppercase tracking-[0.22em] text-copper">Safety note</p>
        <p className="pt-2 text-sm leading-6 text-sand/84">
          Dashboard actions are intentionally displayed as disabled until secure auth, audit trails, and live mutations are in place.
        </p>
      </div>
    </aside>
  );
}
