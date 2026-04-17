export class OperationsSchemaMissingError extends Error {
  readonly migrationFiles: string[];

  constructor(message: string, migrationFiles: string[]) {
    super(message);
    this.name = "OperationsSchemaMissingError";
    this.migrationFiles = migrationFiles;
  }
}

const requiredMigrationFiles = [
  "db/phase-01-reference-tables.sql",
  "db/phase-02-daily-stock.sql",
  "db/phase-03-operations-core.sql",
  "db/phase-09-menu-item-images.sql"
];

type OperationsErrorLike = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
  cause?: unknown;
};

function formatOperationsErrorMessage(error: OperationsErrorLike) {
  const parts = [error.message, error.details, error.hint, error.code ? `code=${error.code}` : null]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  if (parts.length > 0) {
    return parts.join(" | ");
  }

  if (error.cause instanceof Error && error.cause.message.trim().length > 0) {
    return error.cause.message;
  }

  return "Unknown operations error";
}

export function toOperationsError(
  error: OperationsErrorLike | null,
  context: string,
  migrationFiles: string[] = requiredMigrationFiles
) {
  if (!error) {
    return null;
  }

  const message = `${context}: ${formatOperationsErrorMessage(error)}`;
  const normalized = formatOperationsErrorMessage(error).toLowerCase();

  if (
    normalized.includes("schema cache") ||
    normalized.includes("could not find the table") ||
    normalized.includes("could not find the function") ||
    normalized.includes("relation") && normalized.includes("does not exist") ||
    normalized.includes("column") && normalized.includes("does not exist")
  ) {
    return new OperationsSchemaMissingError(message, migrationFiles);
  }

  return new Error(message);
}
