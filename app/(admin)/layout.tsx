import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { redirect } from "next/navigation";
import { isLocalAuthBypassEnabled } from "@/lib/auth/local-bypass";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (await isLocalAuthBypassEnabled()) {
    return (
      <DashboardShell authBypassEnabled userEmail="Localhost auth bypass">
        {children}
      </DashboardShell>
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <DashboardShell userEmail={user.email}>{children}</DashboardShell>;
}
