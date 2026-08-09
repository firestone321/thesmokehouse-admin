import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AdminPushAutoEnrollment } from "@/components/pwa/admin-push-auto-enrollment";
import { redirect } from "next/navigation";
import { isLocalAuthBypassEnabled } from "@/lib/auth/local-bypass";
import { AdminAuthorizationError, requireDashboardRole } from "@/lib/auth/admin-role";
import { AdminNotificationBanner } from "@/components/notifications/admin-notification-banner";
import { getUnreadAdminNotifications } from "@/lib/notifications/data";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (await isLocalAuthBypassEnabled()) {
    return (
      <DashboardShell authBypassEnabled userEmail="Localhost auth bypass" userRole="admin">
        {children}
      </DashboardShell>
    );
  }

  let adminProfile: Awaited<ReturnType<typeof requireDashboardRole>>;
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

  const notifications = await getUnreadAdminNotifications(adminProfile.userId, adminProfile.role);

  return (
    <DashboardShell userEmail={adminProfile.email ?? undefined} userRole={adminProfile.role}>
      <AdminPushAutoEnrollment />
      <AdminNotificationBanner notifications={notifications} />
      {children}
    </DashboardShell>
  );
}
