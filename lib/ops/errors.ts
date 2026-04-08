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
  "db/phase-03-operations-core.sql"
];

export function toOperationsError(error: { message: string } | null, context: string) {
  if (!error) {
    return null;
  }

  const message = `${context}: ${error.message}`;
  const normalized = error.message.toLowerCase();

  if (
    normalized.includes("schema cache") ||
    normalized.includes("could not find the table") ||
    normalized.includes("could not find the function") ||
    normalized.includes("relation") && normalized.includes("does not exist")
  ) {
    return new OperationsSchemaMissingError(message, requiredMigrationFiles);
  }

  return new Error(message);
}
