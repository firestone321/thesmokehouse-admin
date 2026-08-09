import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { getRevenueAnalyticsSeries } from "@/lib/analytics/queries";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getDashboardSnapshot } from "@/lib/ops/queries";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";

export default async function DashboardPage() {
  await requireApprovedAdminRole();
  let snapshot;
  let initialRevenueSeries;

  try {
    [snapshot, initialRevenueSeries] = await Promise.all([getDashboardSnapshot(), getRevenueAnalyticsSeries({ timeframe: "today" })]);
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Dashboard cannot load yet" error={error} />;
    }

    throw error;
  }

  return <LiveDashboard snapshot={snapshot} initialRevenueSeries={initialRevenueSeries} />;
}
