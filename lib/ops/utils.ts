export const ugxFormatter = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0
});

export function formatCurrency(value: number) {
  return ugxFormatter.format(value);
}

export function formatDateTime(value?: string | null) {
  if (!value) return "Not set";

  const formatted = new Intl.DateTimeFormat("en-UG", {
    timeZone: "Africa/Kampala",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));

  return `${formatted} EAT`;
}

export function formatServiceDate(value: string) {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "full"
  }).format(new Date(`${value}T00:00:00+03:00`));
}

export function getUgandaServiceDate(reference = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(reference);
}

export function getUgandaServiceDateOffset(offset: number, reference = new Date()) {
  const serviceDate = getUgandaServiceDate(reference);
  const shifted = new Date(`${serviceDate}T00:00:00+03:00`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return getUgandaServiceDate(shifted);
}

export const DAILY_OPERATIONS_CHECKLIST_ACTIVATION_HOUR = 6;

export function isDailyOperationsChecklistActive(reference = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Kampala",
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(reference).find((part) => part.type === "hour")?.value
  );

  return Number.isFinite(hour) && hour >= DAILY_OPERATIONS_CHECKLIST_ACTIVATION_HOUR;
}

export const END_OF_DAY_CHECKLIST_ACTIVATION_MINUTES = 20 * 60 + 30;

export function isEndOfDayChecklistActive(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kampala",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(reference);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  return Number.isFinite(hour) && Number.isFinite(minute) && hour * 60 + minute >= END_OF_DAY_CHECKLIST_ACTIVATION_MINUTES;
}

export function getUgandaDayRange(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(reference);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to derive the Uganda service date");
  }

  const startUtc = new Date(`${year}-${month}-${day}T00:00:00+03:00`);
  const endUtc = new Date(startUtc);
  endUtc.setUTCDate(endUtc.getUTCDate() + 1);

  return {
    serviceDate: `${year}-${month}-${day}`,
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString()
  };
}

export function toCode(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

export function toInteger(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toOptionalText(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export const DAILY_STOCK_LOW_THRESHOLD = 30;
export const DAILY_STOCK_ELEVATED_THRESHOLD = 20;
export const DAILY_STOCK_CRITICAL_THRESHOLD = 15;

export type DailyStockWarningLevel = "healthy" | "low" | "elevated" | "critical" | "empty";

export function getDailyStockWarningLevel(remainingQuantity: number): DailyStockWarningLevel {
  if (remainingQuantity <= 0) return "empty";
  if (remainingQuantity <= DAILY_STOCK_CRITICAL_THRESHOLD) return "critical";
  if (remainingQuantity <= DAILY_STOCK_ELEVATED_THRESHOLD) return "elevated";
  if (remainingQuantity <= DAILY_STOCK_LOW_THRESHOLD) return "low";
  return "healthy";
}

export function isDailyStockLow(_startingQuantity: number, remainingQuantity: number) {
  return getDailyStockWarningLevel(remainingQuantity) !== "healthy";
}
