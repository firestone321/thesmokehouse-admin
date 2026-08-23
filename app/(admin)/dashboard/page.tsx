import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { getRevenueAnalyticsSeries } from "@/lib/analytics/queries";
import { getDashboardSnapshot } from "@/lib/ops/queries";
import { requireDashboardRole } from "@/lib/auth/admin-role";

export default async function DashboardPage() {
  await requireDashboardRole();
  const [snapshot, initialRevenueSeries] = await Promise.all([
    getDashboardSnapshot(),
    getRevenueAnalyticsSeries({ timeframe: "today" })
  ]);

  return <LiveDashboard snapshot={snapshot} initialRevenueSeries={initialRevenueSeries} />;
}
