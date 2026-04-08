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

  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
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

export function isDailyStockLow(startingQuantity: number, remainingQuantity: number) {
  if (startingQuantity <= 0) return false;

  const threshold = Math.max(1, Math.floor(startingQuantity * 0.25));
  return remainingQuantity <= threshold;
}
