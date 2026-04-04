import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <DashboardShell>{children}</DashboardShell>;
}
