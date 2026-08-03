import { openAdminNotificationAction } from "@/lib/notifications/actions";
import type { AdminNotificationRecord } from "@/lib/notifications/data";

export function AdminNotificationBanner({ notifications }: { notifications: AdminNotificationRecord[] }) {
  if (notifications.length === 0) return null;

  return (
    <section className="mb-4 rounded-[28px] border border-[#E4D8C8] bg-[#FFFDF8] p-4 text-[#111418] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#8A6A45]">Needs your approval</p>
          <h2 className="mt-1 text-lg font-semibold">Menu price suggestions</h2>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#8A6A45]">
          {notifications.length} waiting
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {notifications.map((notification) => (
          <form key={notification.id} action={openAdminNotificationAction}>
            <input type="hidden" name="notification_id" value={notification.id} />
            <button
              type="submit"
              className="min-h-14 w-full rounded-[18px] border border-[#EEE4D8] bg-white px-4 py-3 text-left transition hover:border-[#D7C7B5]"
            >
              <span className="block text-sm font-semibold">{notification.title}</span>
              <span className="mt-1 block text-sm leading-5 text-[#6B7280]">{notification.body}</span>
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}
