import { redirect } from "next/navigation";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { PushDiagnostics } from "@/components/pwa/push-diagnostics";

export const dynamic = "force-dynamic";

export default async function PushDiagnosticsPage() {
  try {
    await requireApprovedAdminRole();
  } catch (error) {
    if (error instanceof AdminAuthorizationError && error.status === 401) {
      redirect("/login?next=/push-diagnostics");
    }
    throw error;
  }
  return <PushDiagnostics />;
}
