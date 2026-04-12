import { ProcurementPortionOption, ProteinProcurementCode } from "@/lib/ops/types";

function normalizeUnitName(unitName: string | null | undefined) {
  return String(unitName ?? "")
    .trim()
    .toLowerCase();
}

function parsePortionWeightInGrams(portionLabel: string | null | undefined) {
  const match = String(portionLabel ?? "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*g$/i);

  if (!match) {
    return null;
  }

  const grams = Number.parseFloat(match[1]);
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

export function getAllowedPortionCodesForReceipt(proteinCode: ProteinProcurementCode | null) {
  switch (proteinCode) {
    case "beef_ribs":
      return ["beef_ribs_350g"];
    case "beef_chunks":
      return ["beef_chunks_350g"];
    case "whole_chicken":
      return ["chicken_half", "chicken_quarter"];
    case "goat_ribs":
      return ["goat_ribs_350g"];
    case "goat_chunks":
      return ["goat_chunks_350g"];
    case "beef":
      return ["beef_ribs_350g", "beef_chunks_350g"];
    case "goat":
      return ["goat_ribs_350g", "goat_chunks_350g"];
    default:
      return [];
  }
}

export function getExpectedYieldEstimate(options: {
  proteinCode: ProteinProcurementCode;
  quantityReceived: number;
  unitName: string;
  portion: ProcurementPortionOption;
}) {
  const { proteinCode, quantityReceived, unitName, portion } = options;

  if (proteinCode === "whole_chicken") {
    if (portion.code === "chicken_half") {
      return {
        quantity: Math.max(0, Math.floor(quantityReceived * 2)),
        detail: `${quantityReceived.toFixed(0)} birds x 2 halves each`
      };
    }

    if (portion.code === "chicken_quarter") {
      return {
        quantity: Math.max(0, Math.floor(quantityReceived * 4)),
        detail: `${quantityReceived.toFixed(0)} birds x 4 quarters each`
      };
    }

    return null;
  }

  const portionWeightInGrams = parsePortionWeightInGrams(portion.portionLabel);
  const normalizedUnit = normalizeUnitName(unitName);

  if (!portionWeightInGrams) {
    return null;
  }

  let totalGrams: number | null = null;

  if (normalizedUnit === "kg" || normalizedUnit === "kilogram" || normalizedUnit === "kilograms") {
    totalGrams = quantityReceived * 1000;
  } else if (normalizedUnit === "g" || normalizedUnit === "gram" || normalizedUnit === "grams") {
    totalGrams = quantityReceived;
  }

  if (totalGrams === null) {
    return null;
  }

  return {
    quantity: Math.max(0, Math.floor(totalGrams / portionWeightInGrams)),
    detail: `${quantityReceived.toFixed(2)} ${unitName} at ${portion.portionLabel} each`
  };
}
