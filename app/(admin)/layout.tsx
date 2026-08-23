import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AdminPushAutoEnrollment } from "@/components/pwa/admin-push-auto-enrollment";
import { redirect } from "next/navigation";
import { isLocalAuthBypassEnabled } from "@/lib/auth/local-bypass";
import { AdminAuthorizationError, requireDashboardRole } from "@/lib/auth/admin-role";
import { AdminNotificationBanner } from "@/components/notifications/admin-notification-banner";
import { getUnreadAdminNotifications } from "@/lib/notifications/data";
import { DailyOperationsGate } from "@/components/dashboard/daily-operations-gate";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getDailyOperationsChecklist } from "@/lib/ops/daily-checklist-data";
import { getUgandaServiceDate, isDailyOperationsChecklistActive } from "@/lib/ops/utils";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let authBypassEnabled = false;
  let adminProfile: Awaited<ReturnType<typeof requireDashboardRole>> | null = null;

  if (await isLocalAuthBypassEnabled()) {
    authBypassEnabled = true;
  } else {
    try {
      adminProfile = await requireDashboardRole();
    } catch (error) {
      if (error instanceof AdminAuthorizationError && error.status === 401) {
        redirect("/login");
      }

      if (error instanceof AdminAuthorizationError && error.status === 403) {
        redirect(
          `/access-denied?message=${encodeURIComponent(
            "This signed-in account is a customer account and does not have access to the Smokehouse admin."
          )}`
        );
      }

      throw error;
    }
  }

  const checklistActive = isDailyOperationsChecklistActive();
  let checklist;
  try {
    checklist = checklistActive ? await getDailyOperationsChecklist(getUgandaServiceDate()) : null;
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Admin cannot load yet" error={error} />;
    }

    throw error;
  }

  const notifications = adminProfile ? await getUnreadAdminNotifications(adminProfile.userId, adminProfile.role) : [];

  return (
    <DailyOperationsGate serviceDate={getUgandaServiceDate()} active={checklistActive} initialRecord={checklist}>
      <DashboardShell
        authBypassEnabled={authBypassEnabled}
        userEmail={adminProfile?.email ?? (authBypassEnabled ? "Localhost auth bypass" : undefined)}
        userRole={adminProfile?.role ?? "admin"}
      >
        {!authBypassEnabled ? <AdminPushAutoEnrollment /> : null}
        <AdminNotificationBanner notifications={notifications} />
        {children}
      </DashboardShell>
    </DailyOperationsGate>
  );
}
