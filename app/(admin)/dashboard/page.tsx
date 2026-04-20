import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getDashboardSnapshot } from "@/lib/ops/queries";

export default async function DashboardPage() {
  let snapshot;

  try {
    snapshot = await getDashboardSnapshot();
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Dashboard cannot load yet" error={error} />;
    }

    throw error;
  }

  return <LiveDashboard snapshot={snapshot} />;
}
