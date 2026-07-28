import Image from "next/image";
import { signOutAction } from "@/lib/auth/actions";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccessDeniedPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const message =
    getFirstValue(params.message) ??
    "This signed-in account is not approved for the Smokehouse admin.";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F4F6F8] px-4 py-8 text-[#111418]">
      <section className="surface-card w-full max-w-lg rounded-[36px] px-6 py-8 text-center shadow-[0_24px_64px_rgba(15,23,42,0.08)] sm:px-10">
        <div className="relative mx-auto h-24 w-24 overflow-hidden rounded-[28px] border border-[#E5E7EB] bg-[#F8FAFB] p-2">
          <Image
            src="/icons/logo-bigger.jpg"
            alt="Firestone Country Smokehouse logo"
            fill
            className="object-contain p-1"
            sizes="96px"
            priority
          />
        </div>
        <p className="mt-6 text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">
          Firestone Country Smokehouse Admin
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Admin access required</h1>
        <p className="mt-4 text-sm leading-7 text-[#6B7280]">{message}</p>
        <p className="mt-3 text-sm leading-7 text-[#6B7280]">
          Sign out, then use a staff account created from the admin dashboard.
        </p>
        <form action={signOutAction} className="mt-7">
          <button
            type="submit"
            className="w-full rounded-2xl bg-[#111418] px-4 py-3 text-sm font-semibold text-white"
          >
            Sign out and use another account
          </button>
        </form>
      </section>
    </main>
  );
}
