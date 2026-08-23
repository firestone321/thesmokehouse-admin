export const DAILY_OPERATIONS_CHECKLIST_ITEMS = [
  {
    id: "staff_readiness",
    label: "Staff readiness",
    standard: "Required staff present; roles allocated; clean uniform/name tag/footwear; personal hygiene and fitness for food handling satisfactory."
  },
  {
    id: "premises_hygiene",
    label: "Premises & hygiene",
    standard: "Work areas are clean; water, handwashing supplies, sanitizer, waste bins and fire-safety provisions ready."
  },
  {
    id: "cold_chain",
    label: "Cold chain",
    standard: "Refrigerator 2–4°C; freezer ≤−18°C; temperatures recorded; raw and cooked foods properly separated."
  },
  {
    id: "food_stock_condition",
    label: "Food & stock condition",
    standard: "Meat/food stock labelled, traceable, within approved holding periods and free from contamination, damage or unexplained thawing."
  },
  {
    id: "production_readiness",
    label: "Production readiness",
    standard: "Today’s production quantities, confirmed orders, available stock and required ingredients/packaging reviewed."
  },
  {
    id: "smoker_readiness",
    label: "Smoker readiness",
    standard: "Smoker clean and safe; firebox, grates, doors, chimney/vents, drainage and stand/wheels satisfactory; probes/thermometers functional."
  },
  {
    id: "other_equipment",
    label: "Other equipment",
    standard: "Fryer, griddle, hot-holding unit, vacuum sealer/freezer and other equipment required today are safe and operational."
  },
  {
    id: "sales_customer_readiness",
    label: "Sales & customer readiness",
    standard: "POS/order channels operational; menu availability reflects actual stock; packaging and pickup/handoff area ready."
  }
] as const;

export type DailyOperationsChecklistItemId = (typeof DAILY_OPERATIONS_CHECKLIST_ITEMS)[number]["id"];
export type DailyOperationsChecklistStatus = "ok" | "issue";

export interface DailyOperationsChecklistResponse {
  status: DailyOperationsChecklistStatus;
  note: string | null;
}

export type DailyOperationsChecklistResponses = Record<
  DailyOperationsChecklistItemId,
  DailyOperationsChecklistResponse
>;

export interface DailyOperationsChecklistRecord {
  serviceDate: string;
  responses: DailyOperationsChecklistResponses;
  submittedByEmail: string;
  submittedByRole: string;
  submittedAt: string;
}

export function isDailyOperationsChecklistItemId(value: string): value is DailyOperationsChecklistItemId {
  return DAILY_OPERATIONS_CHECKLIST_ITEMS.some((item) => item.id === value);
}

export function mapDailyOperationsChecklistRecord(row: any): DailyOperationsChecklistRecord {
  const responses = {} as DailyOperationsChecklistResponses;

  for (const item of DAILY_OPERATIONS_CHECKLIST_ITEMS) {
    const rawResponse = row.responses?.[item.id];
    responses[item.id] = {
      status: rawResponse?.status === "issue" ? "issue" : "ok",
      note: typeof rawResponse?.note === "string" && rawResponse.note.trim() ? rawResponse.note.trim() : null
    };
  }

  return {
    serviceDate: row.service_date,
    responses,
    submittedByEmail: row.submitted_by_email_snapshot,
    submittedByRole: row.submitted_by_role_snapshot,
    submittedAt: row.submitted_at
  };
}
