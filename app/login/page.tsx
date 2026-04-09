import Image from "next/image";
import { redirect } from "next/navigation";
import { sendMagicLinkAction } from "@/lib/auth/actions";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const params = await searchParams;
  const nextPath = getFirstValue(params.next) ?? "/dashboard";
  const message = getFirstValue(params.message) ?? null;

  if (user) {
    redirect(nextPath);
  }

  return (
    <main className="min-h-screen bg-[#F4F6F8] px-4 py-8 text-[#111418]">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="wood-surface hidden rounded-[36px] border border-white/5 p-8 text-[#E6E8EB] shadow-[0_24px_64px_rgba(15,23,42,0.18)] lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="relative mb-6 h-28 w-full overflow-hidden rounded-[28px] border border-white/8 bg-white/5">
              <Image src="/icons/logo-bigger.jpg" alt="Firestone Country Smokehouse logo" fill className="object-cover" sizes="540px" priority />
            </div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#AEB6C2]">Firestone Country Smokehouse Admin</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight">Sign in with a magic link.</h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[#CDD2D8]">
              Enter a staff email that already exists in Supabase Auth. We&apos;ll send a one-time link and keep
              passwords out of the workflow.
            </p>
          </div>
          <div className="rounded-[28px] border border-white/8 bg-white/5 p-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#AEB6C2]">Access rule</p>
            <p className="mt-3 text-sm leading-6 text-[#CDD2D8]">
              Magic links are sent only to saved users. Unknown emails do not get a new account created.
            </p>
          </div>
        </section>

        <section className="surface-card my-auto rounded-[36px] px-6 py-6 shadow-[0_24px_64px_rgba(15,23,42,0.08)] sm:px-8 sm:py-8">
          <div className="relative mb-5 h-20 w-full overflow-hidden rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFB] lg:hidden">
            <Image src="/icons/logo-bigger.jpg" alt="Firestone Country Smokehouse logo" fill className="object-cover" sizes="420px" priority />
          </div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Sign in</p>
          <h2 className="mt-3 text-3xl font-semibold">Get your magic link</h2>
          <p className="mt-3 text-sm leading-6 text-[#6B7280]">
            Use the same email that was already set up for staff access.
          </p>

          {message ? (
            <div className="mt-5 rounded-[24px] border border-[#D7DDE4] bg-[#F8FAFB] px-4 py-3 text-sm leading-6 text-[#4B5563]">
              {message}
            </div>
          ) : null}

          <form action={sendMagicLinkAction} className="mt-6 grid gap-4">
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
            <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-3 text-sm font-semibold text-white">
              Send magic link
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
