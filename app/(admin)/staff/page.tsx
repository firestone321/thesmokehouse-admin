import { createStaffUserAction, manageStaffAccountAction } from "@/lib/auth/staff-actions";
import { canProvisionStaffAccounts, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatRole(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function isAuthUserDisabled(bannedUntil?: string) {
  if (!bannedUntil) {
    return false;
  }

  const bannedUntilTime = Date.parse(bannedUntil);
  return Number.isFinite(bannedUntilTime) && bannedUntilTime > Date.now();
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

  const supabase = createAdminSupabaseClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,email,role,created_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Unable to load staff profiles: ${error.message}`);
  }

  const accounts = await Promise.all(
    (profiles ?? []).map(async (profile) => {
      const { data, error: authError } = await supabase.auth.admin.getUserById(profile.id);

      return {
        ...profile,
        authError: authError?.message ?? null,
        disabled: data.user ? isAuthUserDisabled(data.user.banned_until) : false,
        hasAuthUser: Boolean(data.user)
      };
    })
  );
  const activeAccountCount = accounts.filter((account) => account.hasAuthUser && !account.disabled).length;

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
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Active accounts</p>
            <p className="mt-1 font-semibold">{activeAccountCount}</p>
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
            {accounts.map((profile) => {
              const isCurrentAccount = profile.id === actor.userId;
              const actorCanManageAccount =
                !isCurrentAccount &&
                profile.hasAuthUser &&
                (actor.role === "admin" ? profile.role !== "admin" : profile.role === "staff");

              return (
              <div
                key={profile.id}
                className="rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] px-4 py-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                  <div className="flex flex-wrap gap-2">
                    <span className="w-fit rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4B5563]">
                      {formatRole(profile.role)}
                    </span>
                    <span
                      className={`w-fit rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                        profile.authError || !profile.hasAuthUser
                          ? "bg-[#FFF7ED] text-[#C2410C]"
                          : profile.disabled
                            ? "bg-[#FDECEC] text-[#B42318]"
                            : "bg-[#ECFDF3] text-[#15803D]"
                      }`}
                    >
                      {profile.authError || !profile.hasAuthUser
                        ? "Auth unavailable"
                        : profile.disabled
                          ? "Disabled"
                          : "Active"}
                    </span>
                  </div>
                </div>

                {profile.authError ? (
                  <p className="mt-3 text-xs leading-5 text-[#B45309]">
                    Supabase Auth status could not be loaded: {profile.authError}
                  </p>
                ) : null}

                {isCurrentAccount ? (
                  <p className="mt-3 text-xs font-semibold text-[#6B7280]">Current signed-in account</p>
                ) : actorCanManageAccount ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[#E4E7EB] pt-3">
                    <form action={manageStaffAccountAction}>
                      <input type="hidden" name="user_id" value={profile.id} />
                      <input type="hidden" name="operation" value={profile.disabled ? "enable" : "disable"} />
                      <button
                        type="submit"
                        className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                          profile.disabled
                            ? "bg-[#ECFDF3] text-[#166534]"
                            : "border border-[#F4C7C7] bg-white text-[#B42318]"
                        }`}
                      >
                        {profile.disabled ? "Re-enable account" : "Disable account"}
                      </button>
                    </form>

                    {profile.role === "staff" ? (
                      <form action={manageStaffAccountAction}>
                        <input type="hidden" name="user_id" value={profile.id} />
                        <input type="hidden" name="operation" value="promote_to_manager" />
                        <button
                          type="submit"
                          className="rounded-xl bg-[#111418] px-3 py-2 text-xs font-semibold text-white"
                        >
                          Promote to manager
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[#6B7280]">
                    {profile.role === "admin"
                      ? "Administrator accounts are protected from changes on this page."
                      : "An administrator is required to manage this account."}
                  </p>
                )}
              </div>
              );
            })}
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
