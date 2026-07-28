"use client";

import { type InputHTMLAttributes } from "react";

const formatter = new Intl.NumberFormat("en-UG");

function sanitizeUgxInput(value: string, allowDecimals: boolean, decimalScale: number) {
  const withoutGrouping = value.replace(/[,\s]/g, "");

  if (!allowDecimals) {
    return withoutGrouping.replace(/\D/g, "");
  }

  const [wholePart = "", ...fractionParts] = withoutGrouping.split(".");
  const wholeDigits = wholePart.replace(/\D/g, "");
  const fractionDigits = fractionParts.join("").replace(/\D/g, "").slice(0, decimalScale);
  const hasDecimalPoint = withoutGrouping.includes(".");

  return hasDecimalPoint ? `${wholeDigits || "0"}.${fractionDigits}` : wholeDigits;
}

function formatUgxInput(value: string) {
  if (!value) {
    return "";
  }

  const [wholePart, fractionPart] = value.split(".");
  const normalizedWhole = wholePart.replace(/^0+(?=\d)/, "");
  const formattedWhole = formatter.format(Number(normalizedWhole || "0"));

  return fractionPart === undefined ? formattedWhole : `${formattedWhole}.${fractionPart}`;
}

function formatDefaultValue(value: string | number | readonly string[] | undefined) {
  if (value === undefined || Array.isArray(value)) {
    return "";
  }

  const normalized = String(value).trim();
  if (!normalized || Number(normalized) === 0) {
    return "";
  }

  return formatUgxInput(normalized);
}

type UgxAmountInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "inputMode" | "value" | "onChange"
> & {
  allowDecimals?: boolean;
  decimalScale?: number;
};

export function UgxAmountInput({
  allowDecimals = false,
  decimalScale = 2,
  defaultValue,
  ...props
}: UgxAmountInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode={allowDecimals ? "decimal" : "numeric"}
      defaultValue={formatDefaultValue(defaultValue)}
      onChange={(event) => {
        const sanitized = sanitizeUgxInput(event.currentTarget.value, allowDecimals, decimalScale);
        event.currentTarget.value = formatUgxInput(sanitized);
      }}
    />
  );
}
