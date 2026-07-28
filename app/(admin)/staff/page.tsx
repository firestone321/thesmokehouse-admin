import { createStaffUserAction } from "@/lib/auth/staff-actions";
import { canProvisionStaffAccounts, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatRole(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default async function StaffPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireApprovedAdminRole();
  const canProvision = canProvisionStaffAccounts(actor.role);
  const params = await searchParams;
  const status = getFirstValue(params.status);
  const message = getFirstValue(params.message);

  if (!canProvision) {
    return (
      <section className="surface-card rounded-[32px] px-5 py-6 text-[#111418]">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Staff access</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Staff account management</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#6B7280]">
          Only managers and administrators can create staff accounts or view the staff directory.
        </p>
      </section>
    );
  }

  const { data: profiles, error } = await createAdminSupabaseClient()
    .from("profiles")
    .select("id,email,role,created_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Unable to load staff profiles: ${error.message}`);
  }

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Staff</p>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">Staff account management</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Accounts created here are confirmed Auth users and are assigned to the staff profile directory.
              Storefront signups remain customer accounts.
            </p>
          </div>
          <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3 text-sm">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Active profiles</p>
            <p className="mt-1 font-semibold">{profiles?.length ?? 0}</p>
          </div>
        </div>
      </section>

      {message ? (
        <section
          className={`rounded-[24px] px-4 py-4 text-sm leading-6 ${
            status === "error"
              ? "border border-[#F7D2B1] bg-[#FFF9F2] text-[#8A3F16]"
              : "border border-[#D7E8DA] bg-[#F4FBF5] text-[#166534]"
          }`}
        >
          {message}
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="surface-card rounded-[32px] p-5">
          <div className="border-b border-[#EEF2F6] pb-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Team directory</p>
            <h2 className="mt-2 text-xl font-semibold">Approved dashboard accounts</h2>
          </div>

          <div className="mt-4 grid gap-3">
            {(profiles ?? []).map((profile) => (
              <div
                key={profile.id}
                className="flex flex-col gap-2 rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold">{profile.email}</p>
                  <p className="mt-1 text-xs text-[#6B7280]">
                    Added{" "}
                    {new Date(profile.created_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      timeZone: "Africa/Kampala"
                    })}
                  </p>
                </div>
                <span className="w-fit rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4B5563]">
                  {formatRole(profile.role)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <aside className="surface-card rounded-[32px] p-5">
          <div className="border-b border-[#EEF2F6] pb-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Provision account</p>
            <h2 className="mt-2 text-xl font-semibold">Create staff user</h2>
            <p className="mt-2 text-sm leading-6 text-[#6B7280]">
              The role is fixed to Staff. Share the temporary password securely with the intended user.
            </p>
          </div>

          <form action={createStaffUserAction} className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              Staff email
              <input
                type="email"
                name="email"
                required
                autoComplete="off"
                placeholder="name@company.com"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-3 text-sm font-normal"
              />
            </label>

            <label className="grid gap-2 text-sm font-semibold">
              Temporary password
              <input
                type="password"
                name="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                placeholder="At least 12 characters"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-3 text-sm font-normal"
              />
            </label>

            <label className="grid gap-2 text-sm font-semibold">
              Confirm password
              <input
                type="password"
                name="confirm_password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                placeholder="Repeat the temporary password"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-3 text-sm font-normal"
              />
            </label>

            <div className="rounded-[20px] bg-[#F8FAFB] px-4 py-3 text-sm leading-6 text-[#6B7280]">
              New account role: <span className="font-semibold text-[#111418]">Staff</span>
            </div>

            <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-3 text-sm font-semibold text-white">
              Create staff account
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
