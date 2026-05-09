import { z, type ZodType } from "zod";
import { readJsonWithLimit } from "@/lib/request-limits";

export type ValidationIssue = {
  path: string;
  message: string;
};

export class RequestValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "RequestValidationError";
    this.issues = issues;
  }
}

function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
}

export function parseObject<T>(input: unknown, schema: ZodType<T>): T {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw new RequestValidationError("Validation failed.", toValidationIssues(parsed.error));
  }

  return parsed.data;
}

const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  options?: { maxBytes?: number }
): Promise<T> {
  let body: unknown;

  try {
    body = await readJsonWithLimit(request, options?.maxBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new RequestValidationError("Invalid JSON body.");
    }

    throw error;
  }

  if (body === null) {
    throw new RequestValidationError("Invalid JSON body.");
  }

  return parseObject(body, schema);
}

export function parseSearchParams<T>(url: URL, schema: ZodType<T>): T {
  return parseObject(Object.fromEntries(url.searchParams.entries()), schema);
}
