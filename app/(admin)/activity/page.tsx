import Link from "next/link";
import { canApproveOperationalChanges, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { getStaffActivityLog } from "@/lib/activity/data";
import { formatDateTime } from "@/lib/ops/utils";

function formatAction(action: string) {
  return action.split(".").pop()?.replaceAll("_", " ") ?? action;
}

export default async function ActivityPage() {
  const actor = await requireApprovedAdminRole();
  if (!canApproveOperationalChanges(actor.role)) {
    return (
      <section className="surface-card rounded-[32px] p-5 text-[#111418]">
        <h1 className="text-2xl font-semibold">Activity log</h1>
        <p className="mt-2 text-sm leading-6 text-[#6B7280]">Only administrators and managers can view staff activity.</p>
      </section>
    );
  }

  const activity = await getStaffActivityLog();
  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Administration</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Staff activity</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
          A time-ordered record of operational changes, suggestions, and approvals.
        </p>
      </section>

      <section className="surface-card rounded-[32px] p-4 sm:p-5">
        <div className="space-y-3">
          {activity.length > 0 ? activity.map((entry) => (
            <article key={entry.id} className="rounded-[22px] border border-[#E4E7EB] bg-white px-4 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#F8FAFB] px-3 py-1 text-[11px] font-semibold capitalize text-[#4B5563]">
                      {formatAction(entry.action)}
                    </span>
                    {entry.actorRole ? (
                      <span className="text-xs capitalize text-[#9CA3AF]">{entry.actorRole}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-6">{entry.summary}</p>
                  <p className="mt-1 break-all text-xs text-[#6B7280]">{entry.actorEmail}</p>
                </div>
                <p className="shrink-0 text-xs text-[#6B7280]">{formatDateTime(entry.createdAt)}</p>
              </div>
              {entry.orderId ? (
                <Link href={`/orders/${entry.orderId}`} className="mt-3 inline-flex rounded-xl border border-[#D7DDE4] px-3 py-2 text-xs font-semibold">
                  Open order
                </Link>
              ) : entry.entityType === "menu_item" && entry.entityId ? (
                <Link href={`/menu?edit=${entry.entityId}`} className="mt-3 inline-flex rounded-xl border border-[#D7DDE4] px-3 py-2 text-xs font-semibold">
                  Open menu item
                </Link>
              ) : null}
            </article>
          )) : (
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
              No staff activity has been recorded yet. New changes will appear here.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
