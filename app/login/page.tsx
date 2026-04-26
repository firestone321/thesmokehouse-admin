import Image from "next/image";
import { redirect } from "next/navigation";
import { signInWithPasswordAction } from "@/lib/auth/actions";
import { isLocalAuthBypassEnabled } from "@/lib/auth/local-bypass";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const nextPath = getFirstValue(params.next) ?? "/dashboard";
  const message = getFirstValue(params.message) ?? null;

  if (await isLocalAuthBypassEnabled()) {
    redirect(nextPath);
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect(nextPath);
  }

  return (
    <main className="min-h-screen bg-[#F4F6F8] px-4 py-8 text-[#111418]">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="wood-surface hidden rounded-[36px] border border-white/5 p-8 text-[#E6E8EB] shadow-[0_24px_64px_rgba(15,23,42,0.18)] lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="mb-6 flex items-center gap-4">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[24px] border border-white/8 bg-white/5 p-2">
                <Image src="/icons/logo-bigger.jpg" alt="Firestone Country Smokehouse logo" fill className="object-contain p-1" sizes="80px" priority />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-[#AEB6C2]">Firestone Country Smokehouse</p>
                <p className="mt-2 text-sm text-[#CDD2D8]">Admin</p>
              </div>
            </div>
            <h1 className="mt-4 text-4xl font-semibold leading-tight">Sign in with your password.</h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[#CDD2D8]">
              Enter the staff email and password already set in Supabase Auth. Access remains limited to saved team
              members.
            </p>
          </div>
          <div className="rounded-[28px] border border-white/8 bg-white/5 p-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#AEB6C2]">Access rule</p>
            <p className="mt-3 text-sm leading-6 text-[#CDD2D8]">
              Password sign-in uses existing Supabase Auth users. Unknown emails do not get a new account created.
            </p>
          </div>
        </section>

        <section className="surface-card my-auto rounded-[36px] px-6 py-6 shadow-[0_24px_64px_rgba(15,23,42,0.08)] sm:px-8 sm:py-8">
          <div className="mb-5 flex items-center gap-4 lg:hidden">
            <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[22px] border border-[#E5E7EB] bg-[#F8FAFB] p-2">
              <Image src="/icons/logo-bigger.jpg" alt="Firestone Country Smokehouse logo" fill className="object-contain p-1" sizes="72px" priority />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Firestone Country Smokehouse</p>
              <p className="mt-1 text-sm text-[#6B7280]">Admin</p>
            </div>
          </div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Sign in</p>
          <h2 className="mt-3 text-3xl font-semibold">Enter staff credentials</h2>
          <p className="mt-3 text-sm leading-6 text-[#6B7280]">
            Use the same email and password set up for staff access.
          </p>

          {message ? (
            <div className="mt-5 rounded-[24px] border border-[#D7DDE4] bg-[#F8FAFB] px-4 py-3 text-sm leading-6 text-[#4B5563]">
              {message}
            </div>
          ) : null}

          <form action={signInWithPasswordAction} className="mt-6 grid gap-4">
            <input type="hidden" name="next" value={nextPath} />
            <div className="grid gap-2">
              <label htmlFor="email" className="text-sm font-semibold text-[#111418]">
                Staff email
              </label>
              <input
                id="email"
                type="email"
                name="email"
                required
                placeholder="name@company.com"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-3 text-sm text-[#111418]"
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="password" className="text-sm font-semibold text-[#111418]">
                Password
              </label>
              <input
                id="password"
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-3 text-sm text-[#111418]"
              />
            </div>
            <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-3 text-sm font-semibold text-white">
              Sign in
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
