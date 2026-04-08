import { signOutAction } from "@/lib/auth/actions";

export function LogoutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-2xl border border-white/10 bg-[#2A2F35] px-3 py-2 text-sm font-semibold text-[#E6E8EB]"
      >
        Sign out
      </button>
    </form>
  );
}
