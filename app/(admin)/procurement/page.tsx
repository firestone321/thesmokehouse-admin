import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { ProteinIntakeForm } from "@/components/procurement/protein-intake-form";
import { SupplyIntakeForm } from "@/components/procurement/supply-intake-form";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getProcurementPageData } from "@/lib/ops/queries";
import { formatCurrency, formatDateTime, formatServiceDate } from "@/lib/ops/utils";

function formatQuantity(value: number, unitName: string) {
  return `${value.toFixed(2)} ${unitName}`;
}

function getIntakeBadgeClasses(intakeType: "protein" | "supply") {
  return intakeType === "protein" ? "bg-[#FFF4E5] text-[#B45309]" : "bg-[#E8F1FB] text-[#1D4ED8]";
}

export default async function ProcurementPage() {
  let data;

  try {
    data = await getProcurementPageData();
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Procurement cannot load yet" error={error} />;
    }

    throw error;
  }

  const wholeChickenReceipts = data.recentActivity.filter((entry) => entry.proteinCode === "whole_chicken");
  const totalWholeChickensPlanned = wholeChickenReceipts.reduce((sum, entry) => sum + entry.quantityReceived, 0);
  const totalAllocatedBirds = wholeChickenReceipts.reduce(
    (sum, entry) => sum + entry.allocatedToHalves + entry.allocatedToQuarters,
    0
  );

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Procurement</p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Receiving and intake</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Use procurement to record what came in, from whom, and how it should be planned before it becomes live
              production or tracked supply stock.
            </p>
          </div>

          <div className="grid gap-3 text-sm text-[#6B7280] sm:grid-cols-2">
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Service day</p>
              <p className="mt-1 font-semibold text-[#111418]">{formatServiceDate(data.serviceDate)}</p>
            </div>
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Recent receipts</p>
              <p className="mt-1 font-semibold text-[#111418]">{data.recentActivity.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">Tracked supply items</p>
          <p className="mt-3 text-3xl font-semibold text-[#111418]">{data.inventoryItems.length}</p>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">Active inventory items currently available for supply receiving.</p>
        </article>
        <article className="rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">Whole chickens logged</p>
          <p className="mt-3 text-3xl font-semibold text-[#111418]">{totalWholeChickensPlanned.toFixed(0)}</p>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">Birds recorded in recent procurement activity for yield planning.</p>
        </article>
        <article className="rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">Allocated birds</p>
          <p className="mt-3 text-3xl font-semibold text-[#111418]">{totalAllocatedBirds}</p>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">Whole chickens already planned into half or quarter production.</p>
        </article>
        <article className="rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">Supply side ready</p>
          <p className="mt-3 text-3xl font-semibold text-[#111418]">{data.inventoryItems.filter((item) => item.currentQuantity > item.reorderThreshold).length}</p>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">Tracked items currently above their reorder threshold after audit counts.</p>
        </article>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <ProteinIntakeForm defaultDeliveryDate={data.serviceDate} />
          <SupplyIntakeForm defaultDeliveryDate={data.serviceDate} inventoryItems={data.inventoryItems} />
        </div>

        <aside className="space-y-4">
          <section className="surface-card rounded-[32px] p-5">
            <div className="border-b border-[#EEF2F6] pb-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Receiving Model</p>
              <h2 className="mt-2 text-xl font-semibold">How procurement behaves</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#6B7280]">
              <p className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                Protein receipts are logged here first so the kitchen can plan intake without automatically inflating live
                sellable stock.
              </p>
              <p className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                Supply receipts are logged here and also posted into tracked inventory as a <span className="font-semibold text-[#111418]">restock</span>.
              </p>
              <p className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                Inventory adjustments remain available on the inventory page for corrections, waste, usage, and audit fixes.
              </p>
            </div>
          </section>

          <section className="surface-card rounded-[32px] p-5">
            <div className="flex items-end justify-between gap-3 border-b border-[#EEF2F6] pb-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Recent Procurement Activity</p>
                <h2 className="mt-2 text-xl font-semibold">Latest receipts</h2>
              </div>
              <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-xs font-semibold text-[#4B5563]">
                {data.recentActivity.length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {data.recentActivity.length > 0 ? (
                data.recentActivity.map((entry) => (
                  <article key={entry.id} className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-[#111418]">{entry.itemName}</h3>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${getIntakeBadgeClasses(entry.intakeType)}`}>
                            {entry.intakeType}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[#6B7280]">{entry.supplierName}</p>
                      </div>
                      <p className="text-sm text-[#6B7280]">{formatDateTime(entry.createdAt)}</p>
                    </div>

                    <div className="mt-3 grid gap-3 text-sm text-[#6B7280] sm:grid-cols-2">
                      <div className="rounded-[18px] bg-white px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Received</p>
                        <p className="mt-1 font-semibold text-[#111418]">{formatQuantity(entry.quantityReceived, entry.unitName)}</p>
                      </div>
                      <div className="rounded-[18px] bg-white px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Delivery date</p>
                        <p className="mt-1 font-semibold text-[#111418]">{formatServiceDate(entry.deliveryDate)}</p>
                      </div>
                    </div>

                    {entry.unitCost !== null ? (
                      <p className="mt-3 text-sm text-[#6B7280]">Unit cost {formatCurrency(entry.unitCost)}</p>
                    ) : null}

                    {entry.proteinCode === "whole_chicken" ? (
                      <div className="mt-3 rounded-[18px] border border-[#E4E7EB] bg-white px-3 py-3 text-sm text-[#6B7280]">
                        <p className="font-semibold text-[#111418]">
                          Planned yield: {entry.sellableHalves} halves and {entry.sellableQuarters} quarters
                        </p>
                        <p className="mt-1">
                          Theoretical max: {entry.theoreticalHalfYield} halves or {entry.theoreticalQuarterYield} quarters
                        </p>
                      </div>
                    ) : null}

                    {entry.note ? <p className="mt-3 text-sm leading-6 text-[#6B7280]">{entry.note}</p> : null}
                  </article>
                ))
              ) : (
                <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                  No procurement activity has been logged yet. Your first delivery will appear here with supplier, quantity,
                  and chicken yield planning details where applicable.
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
