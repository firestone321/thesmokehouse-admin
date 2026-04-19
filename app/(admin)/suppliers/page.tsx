import Link from "next/link";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { SavedSuppliersList } from "@/components/suppliers/saved-suppliers-list";
import { SupplierSupplyHistory } from "@/components/suppliers/supplier-supply-history";
import { saveSupplierAction } from "@/lib/ops/actions";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getSuppliersPageData } from "@/lib/ops/queries";
import { supplierTypes, SupplierType } from "@/lib/ops/types";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatSupplierType(value: SupplierType) {
  switch (value) {
    case "mixed":
      return "Mixed";
    case "ingredient":
      return "Ingredient";
    case "supply":
      return "Supply";
    default:
      return "Protein";
  }
}

function SupplierForm({
  supplier
}: {
  supplier?: {
    id: number;
    name: string;
    phoneNumber: string | null;
    licenseNumber: string | null;
    supplierType: SupplierType;
    defaultAbattoirName: string | null;
    isActive: boolean;
    notes: string | null;
  } | null;
}) {
  return (
    <form action={saveSupplierAction} className="mt-4 grid gap-3">
      {supplier ? <input type="hidden" name="supplier_id" value={supplier.id} /> : null}
      <input
        name="name"
        required
        defaultValue={supplier?.name ?? ""}
        placeholder="Supplier name"
        className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
      />
      <input
        name="phone_number"
        defaultValue={supplier?.phoneNumber ?? ""}
        placeholder="Phone number"
        className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
      />
      <input
        name="license_number"
        defaultValue={supplier?.licenseNumber ?? ""}
        placeholder="License number"
        className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
      />
      <select
        name="supplier_type"
        defaultValue={supplier?.supplierType ?? "protein"}
        className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
      >
        {supplierTypes.map((supplierType) => (
          <option key={supplierType} value={supplierType}>
            {formatSupplierType(supplierType)}
          </option>
        ))}
      </select>
      <input
        name="default_abattoir_name"
        defaultValue={supplier?.defaultAbattoirName ?? ""}
        placeholder="Default abattoir name"
        className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-2.5 text-sm text-[#111418]"
      />
      <textarea
        name="notes"
        rows={4}
        defaultValue={supplier?.notes ?? ""}
        placeholder="Notes, receiving instructions, or traceability context"
        className="rounded-2xl border border-[#D7DDE4] bg-white px-3 py-3 text-sm text-[#111418]"
      />
      <label className="flex items-center gap-2 text-sm text-[#6B7280]">
        <input type="checkbox" name="is_active" defaultChecked={supplier?.isActive ?? true} />
        Active supplier
      </label>
      <button type="submit" className="rounded-2xl bg-[#111418] px-4 py-2.5 text-sm font-semibold text-white">
        {supplier ? "Save supplier" : "Create supplier"}
      </button>
    </form>
  );
}

export default async function SuppliersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const selectedSupplierId = getFirstValue(params.supplier) ?? null;
  let data;

  try {
    data = await getSuppliersPageData(selectedSupplierId);
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Suppliers cannot load yet" error={error} />;
    }

    throw error;
  }

  const { suppliers, selectedSupplier, supplyHistory } = data;

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Suppliers</p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Supplier master records</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Keep procurement contacts, licenses, default abattoirs, and operational notes in one place so meat
              receiving can stay traceable without slowing staff down.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-[#6B7280] sm:grid-cols-2">
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Suppliers</p>
              <p className="mt-1 font-semibold text-[#111418]">{suppliers.length}</p>
            </div>
            <Link href="/procurement" className="rounded-[22px] border border-[#D7DDE4] bg-white px-4 py-3 font-semibold text-[#111418]">
              Back to resupplies
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <section className="surface-card rounded-[32px] p-5">
          <div className="border-b border-[#EEF2F6] pb-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Supply history</p>
            <h2 className="mt-2 text-xl font-semibold">All supplier intake history</h2>
          </div>

          <div className="mt-4">
            <p className="text-sm leading-6 text-[#6B7280]">
              Everything is unified here: protein, chicken, and non-protein intake records in one searchable history stream.
            </p>
            <div className="mt-4">
              <SupplierSupplyHistory history={supplyHistory} />
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Saved suppliers</p>
              <h2 className="mt-2 text-xl font-semibold">Available supplier records</h2>
            </div>

            <div className="mt-4">
              <SavedSuppliersList suppliers={suppliers} selectedSupplierId={selectedSupplier?.id ?? null} />
            </div>
          </section>

          {selectedSupplier ? (
            <section className="surface-card rounded-[32px] p-5">
              <div className="border-b border-[#EEF2F6] pb-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Selected supplier</p>
                <h2 className="mt-2 text-xl font-semibold">{selectedSupplier.name}</h2>
              </div>
              <SupplierForm supplier={selectedSupplier} />
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
