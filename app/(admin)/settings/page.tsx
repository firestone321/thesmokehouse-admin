import { SectionPlaceholder } from "@/components/dashboard/section-placeholder";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";

export default async function SettingsPage() {
  await requireApprovedAdminRole();
  return (
    <SectionPlaceholder
      title="Settings"
      description="Operational settings will live here after we define a permissions model, audit requirements, and rollback-safe configuration flows."
    />
  );
}
