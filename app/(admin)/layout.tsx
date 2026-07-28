import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AdminPushAutoEnrollment } from "@/components/pwa/admin-push-auto-enrollment";
import { redirect } from "next/navigation";
import { isLocalAuthBypassEnabled } from "@/lib/auth/local-bypass";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (await isLocalAuthBypassEnabled()) {
    return (
      <DashboardShell authBypassEnabled userEmail="Localhost auth bypass">
        {children}
      </DashboardShell>
    );
  }

  let adminProfile: Awaited<ReturnType<typeof requireApprovedAdminRole>>;
  try {
    adminProfile = await requireApprovedAdminRole();
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

  return (
    <DashboardShell userEmail={adminProfile.email ?? undefined}>
      <AdminPushAutoEnrollment />
      {children}
    </DashboardShell>
  );
}
