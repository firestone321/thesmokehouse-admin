import { type ZodType } from "zod";
import { parseObject } from "@/lib/validation/http";

export function formDataToObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export function parseFormData<T>(formData: FormData, schema: ZodType<T>): T {
  return parseObject(formDataToObject(formData), schema);
}
