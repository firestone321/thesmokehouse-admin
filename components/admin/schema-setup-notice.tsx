import { OperationsSchemaMissingError } from "@/lib/ops/errors";

export function SchemaSetupNotice({
  title,
  error
}: {
  title: string;
  error: OperationsSchemaMissingError;
}) {
  return (
    <section className="surface-card rounded-[32px] p-6 text-[#111418]">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Database setup required</p>
      <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{title}</h1>
      <p className="mt-4 max-w-3xl text-sm leading-6 text-[#6B7280]">{error.message}</p>

      <div className="mt-5 rounded-[24px] bg-[#F8FAFB] p-5">
        <p className="text-sm font-semibold text-[#111418]">Apply these SQL files in Supabase, in this order:</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#6B7280]">
          {error.migrationFiles.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-6 text-[#6B7280]">
          Run them in the Supabase SQL editor or your preferred Postgres migration tool, then refresh this page.
        </p>
      </div>
    </section>
  );
}
