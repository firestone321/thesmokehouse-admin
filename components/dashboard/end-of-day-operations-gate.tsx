"use client";

import { useEffect, useMemo, useState } from "react";
import {
  END_OF_DAY_CHECKLIST_ITEMS,
  type EndOfDayChecklistRecord,
  type EndOfDayChecklistResponses,
  type EndOfDayChecklistStatus
} from "@/lib/ops/end-of-day-checklist";
import { formatServiceDate } from "@/lib/ops/utils";

export function EndOfDayOperationsGate({
  serviceDate,
  active: initialActive,
  initialRecord,
  children
}: {
  serviceDate: string;
  active: boolean;
  initialRecord: EndOfDayChecklistRecord | null;
  children: React.ReactNode;
}) {
  const [record, setRecord] = useState(initialRecord);
  const [active, setActive] = useState(initialActive);
  const [checklistDate, setChecklistDate] = useState(serviceDate);
  const [responses, setResponses] = useState<Partial<EndOfDayChecklistResponses>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setResponses({});
    setError(null);
  }, [checklistDate]);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch("/api/admin/end-of-day-checklist", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        setChecklistDate(payload.serviceDate);
        setActive(Boolean(payload.active));
        setRecord(payload.record);
      } catch {
        // The form remains available for a direct submission if polling fails.
      }
    }, 10000);

    return () => window.clearInterval(interval);
  }, [serviceDate]);

  const answeredCount = useMemo(
    () => END_OF_DAY_CHECKLIST_ITEMS.filter((item) => responses[item.id]?.status).length,
    [responses]
  );

  if (!active || record) return <>{children}</>;

  function setStatus(itemId: keyof EndOfDayChecklistResponses, status: EndOfDayChecklistStatus) {
    setResponses((current) => ({
      ...current,
      [itemId]: {
        status,
        note: current[itemId]?.note ?? null
      }
    }));
    setError(null);
  }

  function setNote(itemId: keyof EndOfDayChecklistResponses, note: string) {
    setResponses((current) => ({
      ...current,
      [itemId]: {
        status: current[itemId]?.status ?? "issue",
        note
      }
    }));
  }

  async function submitChecklist() {
    setError(null);
    const missingItem = END_OF_DAY_CHECKLIST_ITEMS.find((item) => !responses[item.id]?.status);
    if (missingItem) {
      setError(`Answer ${missingItem.label} before closing the day.`);
      return;
    }

    const missingNote = END_OF_DAY_CHECKLIST_ITEMS.find(
      (item) => responses[item.id]?.status === "issue" && !responses[item.id]?.note?.trim()
    );
    if (missingNote) {
      setError(`Add a note for the issue recorded under ${missingNote.label}.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/end-of-day-checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceDate: checklistDate, responses })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "The end-of-day checklist could not be completed.");
      setRecord(payload.record);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "The end-of-day checklist could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="surface-card rounded-[32px] p-5 text-[#111418] sm:p-7">
      <div className="flex flex-col gap-3 border-b border-[#E4E7EB] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Closing control</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">End-of-day checklist</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6B7280]">
            This opens automatically at 9:00 PM EAT and remains pending until completed. Complete it once for the whole team; the first valid submission becomes the shared record for {formatServiceDate(checklistDate)}.
          </p>
        </div>
        <div className="rounded-2xl bg-[#F8FAFB] px-4 py-3 text-sm text-[#4B5563]">
          <p className="font-semibold text-[#111418]">{formatServiceDate(checklistDate)}</p>
          <p className="mt-1">{answeredCount}/{END_OF_DAY_CHECKLIST_ITEMS.length} answered</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {END_OF_DAY_CHECKLIST_ITEMS.map((item, index) => {
          const response = responses[item.id];
          return (
            <article key={item.id} className="rounded-[24px] border border-[#E4E7EB] bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">{index + 1}</p>
                  <h2 className="mt-1 text-base font-semibold">{item.label}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#6B7280]">{item.standard}</p>
                </div>
                <div className="flex shrink-0 gap-2" role="group" aria-label={`${item.label} status`}>
                  {(["ok", "issue"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatus(item.id, status)}
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold capitalize transition ${
                        response?.status === status
                          ? status === "ok"
                            ? "border-[#2E7D32] bg-[#E8F5E9] text-[#1B5E20]"
                            : "border-[#B45309] bg-[#FFF7ED] text-[#92400E]"
                          : "border-[#D7DDE4] bg-white text-[#6B7280] hover:bg-[#F8FAFB]"
                      }`}
                    >
                      {status === "ok" ? "OK" : "Issue"}
                    </button>
                  ))}
                </div>
              </div>
              {response?.status === "issue" ? (
                <label className="mt-4 block text-sm font-semibold text-[#374151]">
                  Issue note
                  <textarea
                    value={response.note ?? ""}
                    onChange={(event) => setNote(item.id, event.target.value)}
                    placeholder="Describe what was found and what needs attention."
                    maxLength={1000}
                    rows={3}
                    className="mt-2 w-full rounded-2xl border border-[#D7DDE4] bg-[#FBFCFD] px-3 py-3 text-sm font-normal outline-none transition focus:border-[#111418]"
                  />
                </label>
              ) : null}
            </article>
          );
        })}
      </div>

      {error ? <p className="mt-4 rounded-2xl bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#991B1B]">{error}</p> : null}
      <button
        type="button"
        onClick={submitChecklist}
        disabled={isSubmitting}
        className="mt-5 w-full rounded-2xl bg-[#111418] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#2A2F35] disabled:cursor-wait disabled:opacity-60"
      >
        {isSubmitting ? "Saving todayâ€™s closing checklistâ€¦" : "Complete checklist and close the day"}
      </button>
    </section>
  );
}
