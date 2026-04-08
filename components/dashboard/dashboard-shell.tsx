import { ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { AdminSidebar } from "@/components/dashboard/admin-sidebar";

interface DashboardShellProps {
  children: ReactNode;
  userEmail?: string | null;
}

export function DashboardShell({ children, userEmail }: DashboardShellProps) {
  return (
    <div className="min-h-screen bg-[#F4F6F8]">
      <div className="mx-auto grid min-h-screen max-w-[1720px] grid-cols-1 gap-4 px-3 py-3 lg:grid-cols-[208px_minmax(0,1fr)] lg:px-5 lg:py-5 2xl:grid-cols-[212px_minmax(0,1fr)]">
        <AdminSidebar userEmail={userEmail} logoutSlot={<LogoutButton />} />
        <main>{children}</main>
      </div>
    </div>
  );
}
