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

    const message =
      error instanceof Error ? error.message : "This account is not approved for the Smokehouse admin.";
    redirect(`/login?message=${encodeURIComponent(message)}`);
  }

  return (
    <DashboardShell userEmail={adminProfile.email ?? undefined}>
      <AdminPushAutoEnrollment />
      {children}
    </DashboardShell>
  );
}
