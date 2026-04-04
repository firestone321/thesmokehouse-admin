import { ReactNode } from "react";
import { AdminSidebar } from "@/components/dashboard/admin-sidebar";

interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto grid min-h-screen max-w-[1680px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-6 lg:py-6">
        <AdminSidebar />
        <main>{children}</main>
      </div>
    </div>
  );
}
