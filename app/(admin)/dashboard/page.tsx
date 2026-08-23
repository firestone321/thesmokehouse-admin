import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { DailyOperationsGate } from "@/components/dashboard/daily-operations-gate";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { getRevenueAnalyticsSeries } from "@/lib/analytics/queries";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getDashboardSnapshot } from "@/lib/ops/queries";
import { requireDashboardRole } from "@/lib/auth/admin-role";
import { getDailyOperationsChecklist } from "@/lib/ops/daily-checklist-data";
import { getUgandaServiceDate, isDailyOperationsChecklistActive } from "@/lib/ops/utils";

export default async function DashboardPage() {
  await requireDashboardRole();
  const serviceDate = getUgandaServiceDate();
  let snapshot;
  let initialRevenueSeries;
  let checklist;
  const checklistActive = isDailyOperationsChecklistActive();

  try {
    [snapshot, initialRevenueSeries, checklist] = await Promise.all([
      getDashboardSnapshot(),
      getRevenueAnalyticsSeries({ timeframe: "today" }),
      checklistActive ? getDailyOperationsChecklist(serviceDate) : Promise.resolve(null)
    ]);
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Dashboard cannot load yet" error={error} />;
    }

    throw error;
  }

  return (
    <DailyOperationsGate serviceDate={serviceDate} active={checklistActive} initialRecord={checklist}>
      <LiveDashboard snapshot={snapshot} initialRevenueSeries={initialRevenueSeries} />
    </DailyOperationsGate>
  );
}
