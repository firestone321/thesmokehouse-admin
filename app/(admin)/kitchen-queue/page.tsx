import { SectionPlaceholder } from "@/components/dashboard/section-placeholder";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";

export default async function KitchenQueuePage() {
  await requireApprovedAdminRole();
  return (
    <SectionPlaceholder
      title="Kitchen Queue"
      description="The dedicated kitchen queue workspace will expand from the dashboard selectors once production sequencing, station capacity, and handoff rules are defined."
    />
  );
}
