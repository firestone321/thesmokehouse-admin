import Link from "next/link";
import { canApproveOperationalChanges, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { getStaffActivityLogPage } from "@/lib/activity/data";
import { formatDateTime } from "@/lib/ops/utils";

function formatAction(action: string) {
  return action.split(".").pop()?.replaceAll("_", " ") ?? action;
}

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

const activityDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Kampala",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const activityDateLabelFormatter = new Intl.DateTimeFormat("en-UG", {
  timeZone: "Africa/Kampala",
  dateStyle: "full"
});

function groupActivityByDate(activity: Awaited<ReturnType<typeof getStaffActivityLogPage>>["activity"]) {
  const groups = new Map<string, typeof activity>();

  for (const entry of activity) {
    const dateKey = activityDateKeyFormatter.format(new Date(entry.createdAt));
    const entries = groups.get(dateKey) ?? [];
    entries.push(entry);
    groups.set(dateKey, entries);
  }

  return Array.from(groups, ([dateKey, entries]) => ({
    dateKey,
    label: activityDateLabelFormatter.format(new Date(`${dateKey}T00:00:00+03:00`)),
    entries
  }));
}
export default async function ActivityPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedPage = Math.max(1, parseInt(getFirstValue(params.page) ?? "1", 10) || 1);
  const requestedDate = getFirstValue(params.date) ?? "";
  const actor = await requireApprovedAdminRole();
  if (!canApproveOperationalChanges(actor.role)) {
    return (
      <section className="surface-card rounded-[32px] p-5 text-[#111418]">
        <h1 className="text-2xl font-semibold">Activity log</h1>
        <p className="mt-2 text-sm leading-6 text-[#6B7280]">Only administrators and managers can view staff activity.</p>
      </section>
    );
  }

  const { activity, page, totalPages, total, hasNextPage } = await getStaffActivityLogPage(requestedPage, requestedDate);
  const activityGroups = groupActivityByDate(activity);
  const activityPageUrl = (targetPage: number) => {
    const query = new URLSearchParams();
    if (requestedDate) query.set("date", requestedDate);
    if (targetPage > 1) query.set("page", String(targetPage));
    const queryString = query.toString();
    return queryString ? `/activity?${queryString}` : "/activity";
  };
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
        <div className="mb-4 flex flex-col gap-2 border-b border-[#EEF2F6] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Activity history</p>
            <h2 className="mt-1 text-lg font-semibold">Latest staff changes</h2>
          </div>
          <p className="text-sm text-[#6B7280]">{total} entries · Page {page} of {totalPages}</p>
        </div>
        <form method="get" className="mb-5 flex flex-col gap-3 rounded-[22px] border border-[#E4E7EB] bg-[#F8FAFB] p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="activity-date" className="text-xs font-semibold text-[#4B5563]">Search by date</label>
            <input id="activity-date" name="date" type="date" defaultValue={requestedDate} className="mt-2 block w-full rounded-xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]" />
          </div>
          <button type="submit" className="rounded-xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">Search</button>
          {requestedDate ? <Link href="/activity" className="rounded-xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-center text-sm font-semibold text-[#111418]">Clear</Link> : null}
        </form>        <div className="space-y-6">
          {activityGroups.length > 0 ? activityGroups.map((group) => (
            <section key={group.dateKey} aria-labelledby={`activity-date-${group.dateKey}`}>
              <div className="mb-3 flex items-center gap-3">
                <h3 id={`activity-date-${group.dateKey}`} className="text-sm font-semibold text-[#4B5563]">{group.label}</h3>
                <div className="h-px flex-1 bg-[#EEF2F6]" />
              </div>
              <div className="space-y-3">
                {group.entries.map((entry) => (
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
                ))}
              </div>
            </section>
          )) : (
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-5 text-sm leading-6 text-[#6B7280]">
              No staff activity has been recorded yet. New changes will appear here.
            </div>
          )}
        </div>
        {(page > 1 || hasNextPage) ? (
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-[#EEF2F6] pt-4">
            {page > 1 ? (
              <Link href={activityPageUrl(page - 1)} className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]">
                Previous
              </Link>
            ) : <span className="rounded-2xl border border-[#E4E7EB] px-4 py-2.5 text-sm font-semibold text-[#9CA3AF]">Previous</span>}
            <span className="text-sm text-[#6B7280]">Page {page}</span>
            {hasNextPage ? (
              <Link href={activityPageUrl(page + 1)} className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]">
                Next
              </Link>
            ) : <span className="rounded-2xl border border-[#E4E7EB] px-4 py-2.5 text-sm font-semibold text-[#9CA3AF]">Next</span>}
          </div>
        ) : null}
      </section>
    </div>
  );
}
