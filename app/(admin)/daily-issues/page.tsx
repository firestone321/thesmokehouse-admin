import { canApproveOperationalChanges, requireDashboardRole } from "@/lib/auth/admin-role";
import { getDailyOperationsChecklistHistory } from "@/lib/ops/daily-checklist-data";
import { DAILY_OPERATIONS_CHECKLIST_ITEMS } from "@/lib/ops/daily-checklist";
import { getEndOfDayChecklistHistory } from "@/lib/ops/end-of-day-checklist-data";
import { END_OF_DAY_CHECKLIST_ITEMS } from "@/lib/ops/end-of-day-checklist";
import { formatDateTime, formatServiceDate } from "@/lib/ops/utils";

type ChecklistHistoryRecord = {
  serviceDate: string;
  responses: Record<string, { status: "ok" | "issue"; note: string | null }>;
  submittedByEmail: string;
  submittedByRole: string;
  submittedAt: string;
};

function ChecklistHistory({
  title,
  records,
  items
}: {
  title: string;
  records: ChecklistHistoryRecord[];
  items: readonly { id: string; label: string }[];
}) {
  return (
    <section className="space-y-4">
      <h2 className="px-1 text-xl font-semibold">{title}</h2>
      {records.length > 0 ? records.map((record) => {
        const issues = items
          .map((item) => ({ item, response: record.responses[item.id] }))
          .filter(({ response }) => response.status === "issue");

        return (
          <section key={record.serviceDate} className="surface-card rounded-[32px] p-5">
            <div className="flex flex-col gap-3 border-b border-[#E4E7EB] pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-lg font-semibold">{formatServiceDate(record.serviceDate)}</p>
                <p className="mt-1 text-sm text-[#6B7280]">
                  Cleared by {record.submittedByEmail} ({record.submittedByRole}) on {formatDateTime(record.submittedAt)}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${issues.length > 0 ? "bg-[#FFF7ED] text-[#92400E]" : "bg-[#E8F5E9] text-[#1B5E20]"}`}>
                {issues.length > 0 ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : "No issues"}
              </span>
            </div>

            {issues.length > 0 ? (
              <div className="mt-4 space-y-3">
                {issues.map(({ item, response }) => (
                  <article key={item.id} className="rounded-2xl border border-[#FED7AA] bg-[#FFF7ED] px-4 py-4">
                    <h3 className="font-semibold text-[#7C2D12]">{item.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#92400E]">{response.note || "No note supplied."}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-2xl bg-[#F8FAFB] px-4 py-4 text-sm text-[#6B7280]">All checks were marked OK.</p>
            )}
          </section>
        );
      }) : (
        <section className="surface-card rounded-[32px] p-5 text-sm leading-6 text-[#6B7280]">
          No completed checklists have been recorded yet.
        </section>
      )}
    </section>
  );
}

export default async function DailyIssuesPage() {
  const actor = await requireDashboardRole();
  if (!canApproveOperationalChanges(actor.role)) {
    return (
      <section className="surface-card rounded-[32px] p-5 text-[#111418]">
        <h1 className="text-2xl font-semibold">Daily checklist issues</h1>
        <p className="mt-2 text-sm leading-6 text-[#6B7280]">Only administrators and managers can view daily checklist issues.</p>
      </section>
    );
  }

  const [openingRecords, closingRecords] = await Promise.all([
    getDailyOperationsChecklistHistory(),
    getEndOfDayChecklistHistory()
  ]);
  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Administration</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Daily checklist issues</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B7280]">
          Review issues recorded during opening and end-of-day checks, including notes and the staff member who cleared each checklist.
        </p>
      </section>
      <ChecklistHistory title="Start-of-day checks" records={openingRecords} items={DAILY_OPERATIONS_CHECKLIST_ITEMS} />
      <ChecklistHistory title="End-of-day checks" records={closingRecords} items={END_OF_DAY_CHECKLIST_ITEMS} />
    </div>
  );
}
