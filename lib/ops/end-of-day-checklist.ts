export const END_OF_DAY_CHECKLIST_ITEMS = [
  {
    id: "orders_completed",
    label: "Orders completed",
    standard: "Confirmed orders and pickups are accounted for; complaints, missing items, cancellations or handoff problems are recorded."
  },
  {
    id: "stock_reconciliation",
    label: "Stock reconciliation",
    standard: "Opening stock, production, sales/orders, approved samples/staff use, preservation stock, waste and closing stock reconcile."
  },
  {
    id: "waste_recorded",
    label: "Waste recorded",
    standard: "Meat/food waste, overcooking, contamination, dropped product and unexplained variance are recorded with a reason."
  },
  {
    id: "remaining_food_controlled",
    label: "Remaining food controlled",
    standard: "Remaining cooked/raw product is correctly hot-held, refrigerated, preserved, placed ON HOLD or discarded; nothing is left uncontrolled."
  },
  {
    id: "cold_chain_close",
    label: "Cold-chain close",
    standard: "Closing refrigerator and freezer temperatures are recorded; refrigeration remains operating normally."
  },
  {
    id: "cleaning_sanitation",
    label: "Cleaning & sanitation",
    standard: "Food-contact surfaces, utensils, smoker/grates, grease areas and work areas are cleaned and sanitized appropriately."
  },
  {
    id: "fire_gas_electrical_safety",
    label: "Fire / gas / electrical safety",
    standard: "Smoker fire is safely controlled; gas/electrical equipment is in a safe shutdown condition; no unattended fire or obvious hazard remains."
  },
  {
    id: "equipment_condition",
    label: "Equipment condition",
    standard: "Any damaged probe, seal, firebrick, wheel/caster, refrigeration, gas/electrical or other equipment fault is recorded and reported."
  },
  {
    id: "records_deviations",
    label: "Records & deviations",
    standard: "Required temperature, production, waste, stock and incident records are complete; unresolved deviations are identified."
  },
  {
    id: "security_next_day_readiness",
    label: "Security & next-day readiness",
    standard: "Premises are secured; key shortages, repairs, stock requirements or next-day production concerns are handed over."
  }
] as const;

export type EndOfDayChecklistItemId = (typeof END_OF_DAY_CHECKLIST_ITEMS)[number]["id"];
export type EndOfDayChecklistStatus = "ok" | "issue";

export interface EndOfDayChecklistResponse {
  status: EndOfDayChecklistStatus;
  note: string | null;
}

export type EndOfDayChecklistResponses = Record<EndOfDayChecklistItemId, EndOfDayChecklistResponse>;

export interface EndOfDayChecklistRecord {
  serviceDate: string;
  responses: EndOfDayChecklistResponses;
  submittedByEmail: string;
  submittedByRole: string;
  submittedAt: string;
}

export function mapEndOfDayChecklistRecord(row: any): EndOfDayChecklistRecord {
  const responses = {} as EndOfDayChecklistResponses;

  for (const item of END_OF_DAY_CHECKLIST_ITEMS) {
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
