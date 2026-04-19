import Link from "next/link";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { CollapsibleCard } from "@/components/procurement/collapsible-card";
import { ProcessingBatchForm } from "@/components/procurement/processing-batch-form";
import { ProteinIntakeForm } from "@/components/procurement/protein-intake-form";
import { SidesIntakeForm } from "@/components/procurement/sides-intake-form";
import { SupplyIntakeForm } from "@/components/procurement/supply-intake-form";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getProcurementPageData } from "@/lib/ops/queries";
import { formatCurrency, formatDateTime, formatServiceDate } from "@/lib/ops/utils";

function formatQuantity(value: number, unitName: string) {
  return `${value.toFixed(2)} ${unitName}`;
}

function getIntakeBadgeClasses(intakeType: "protein" | "ingredient" | "supply") {
  if (intakeType === "protein") {
    return "bg-[#FFF4E5] text-[#B45309]";
  }

  if (intakeType === "ingredient") {
    return "bg-[#ECFDF3] text-[#15803D]";
  }

  return "bg-[#E8F1FB] text-[#1D4ED8]";
}

export default async function ProcurementPage() {
  let data;

  try {
    data = await getProcurementPageData();
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Resupplies cannot load yet" error={error} />;
    }

    throw error;
  }

  const wholeChickenReceipts = data.recentActivity.filter((entry) => entry.proteinCode === "whole_chicken");
  const proteinReceipts = data.recentActivity.filter((entry) => entry.intakeType === "protein");
  const processingProteinReceipts = data.processingProteinReceipts;
  const proteinSuppliers = data.suppliers.filter(
    (supplier) => supplier.supplierType === "protein" || supplier.supplierType === "mixed"
  );
  const ingredientSuppliers = data.suppliers.filter(
    (supplier) => supplier.supplierType === "ingredient" || supplier.supplierType === "mixed"
  );
  const supplySuppliers = data.suppliers.filter(
    (supplier) => supplier.supplierType === "supply" || supplier.supplierType === "mixed"
  );
  const totalProteinReceipts = proteinReceipts.length;
  const totalWholeChickensPlanned = wholeChickenReceipts.reduce((sum, entry) => sum + entry.quantityReceived, 0);
  const totalProcessedChickenPortions = wholeChickenReceipts.reduce(
    (sum, entry) => sum + entry.processedHalves + entry.processedQuarters,
    0
  );

  return (
    <div className="space-y-4 text-[#111418]">
      <section className="surface-card rounded-[32px] px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B7280]">Resupplies</p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Protein receiving and processing</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B7280]">
              Use this page for raw meat receiving, side-input receiving, finished-stock processing, and non-consumable
              resupplies such as Clamcraft boxes and butcher paper.
            </p>
          </div>

          <div className="grid gap-3 text-sm text-[#6B7280] sm:grid-cols-2">
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Service day</p>
              <p className="mt-1 font-semibold text-[#111418]">{formatServiceDate(data.serviceDate)}</p>
            </div>
            <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Recent deliveries</p>
              <p className="mt-1 font-semibold text-[#111418]">{data.recentActivity.length}</p>
            </div>
            <Link
              href="/suppliers"
              className="rounded-[22px] border border-[#D7DDE4] bg-white px-4 py-3 font-semibold text-[#111418] sm:col-span-2"
            >
              Manage suppliers
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">Protein receipts</p>
          <p className="mt-3 text-3xl font-semibold text-[#111418]">{totalProteinReceipts}</p>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">Recent raw protein deliveries recorded for intake and planning.</p>
        </article>
        <article className="rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">Whole chickens logged</p>
          <p className="mt-3 text-3xl font-semibold text-[#111418]">{totalWholeChickensPlanned.toFixed(0)}</p>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">Whole birds recorded in recent protein receipts.</p>
        </article>
        <article className="rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">Processing batches</p>
          <p className="mt-3 text-3xl font-semibold text-[#111418]">{data.recentProcessingBatches.length}</p>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">Recent finished-stock batches recorded from protein receipts.</p>
        </article>
        <article className="rounded-[26px] border border-[#E4E7EB] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">Chicken portions processed</p>
          <p className="mt-3 text-3xl font-semibold text-[#111418]">{totalProcessedChickenPortions}</p>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">Half and quarter portions already added into finished frozen stock.</p>
        </article>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <ProteinIntakeForm defaultDeliveryDate={data.serviceDate} suppliers={proteinSuppliers} />
          <ProcessingBatchForm portionOptions={data.portionOptions} proteinReceipts={processingProteinReceipts} />
        </div>

        <aside className="space-y-4">
          <SidesIntakeForm
            defaultDeliveryDate={data.serviceDate}
            inventoryItems={data.inventoryItems}
            suppliers={ingredientSuppliers}
          />
          <SupplyIntakeForm
            defaultDeliveryDate={data.serviceDate}
            inventoryItems={data.inventoryItems}
            suppliers={supplySuppliers}
            returnTo="/procurement"
          />

          <CollapsibleCard
            eyebrow="Recent Protein Activity"
            title="Latest receipts"
            count={proteinReceipts.length}
            collapsedMessage="Expand this card when you need to review the latest protein intake receipts."
          >
              {proteinReceipts.length > 0 ? (
                proteinReceipts.map((entry) => (
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
                        {entry.batchNumber ? (
                          <p className="mt-1 text-sm text-[#6B7280]">Batch {entry.batchNumber}</p>
                        ) : null}
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
                      {entry.butcheredOn ? (
                        <div className="rounded-[18px] bg-white px-3 py-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Butchered</p>
                          <p className="mt-1 font-semibold text-[#111418]">{formatServiceDate(entry.butcheredOn)}</p>
                        </div>
                      ) : null}
                      {entry.abattoirName ? (
                        <div className="rounded-[18px] bg-white px-3 py-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-[#9CA3AF]">Abattoir</p>
                          <p className="mt-1 font-semibold text-[#111418]">{entry.abattoirName}</p>
                        </div>
                      ) : null}
                    </div>

                    {entry.unitCost !== null ? (
                      <p className="mt-3 text-sm text-[#6B7280]">Unit cost {formatCurrency(entry.unitCost)}</p>
                    ) : null}

                    {entry.vetStampNumber || entry.inspectionOfficerName ? (
                      <div className="mt-3 rounded-[18px] border border-[#E4E7EB] bg-white px-3 py-3 text-sm text-[#6B7280]">
                        {entry.vetStampNumber ? <p>Vet stamp: {entry.vetStampNumber}</p> : null}
                        {entry.inspectionOfficerName ? <p>Inspection officer: {entry.inspectionOfficerName}</p> : null}
                      </div>
                    ) : null}

                    {entry.proteinCode === "whole_chicken" ? (
                      <div className="mt-3 rounded-[18px] border border-[#E4E7EB] bg-white px-3 py-3 text-sm text-[#6B7280]">
                        <p className="font-semibold text-[#111418]">Yield is recorded later during processing.</p>
                        <p className="mt-1">Processed so far: {entry.processedHalves} halves and {entry.processedQuarters} quarters</p>
                      </div>
                    ) : null}

                    {entry.note ? <p className="mt-3 text-sm leading-6 text-[#6B7280]">{entry.note}</p> : null}
                  </article>
                ))
              ) : (
                <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                  No protein receipts have been logged yet. Your first delivery will appear here with supplier and quantity.
                </div>
              )}
          </CollapsibleCard>

          <CollapsibleCard
            eyebrow="Finished Frozen Stock"
            title="What is ready for future orders"
            count={data.finishedStock.length}
            collapsedMessage="Expand this card when you need to review the finished frozen stock currently on hand."
          >
              {data.finishedStock.length > 0 ? (
                data.finishedStock.map((item) => (
                  <article key={item.portionTypeId} className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-[#111418]">{item.portionLabel}</h3>
                        <p className="mt-1 text-sm text-[#6B7280]">{item.proteinCode ?? "General"}</p>
                      </div>
                      <p className="text-sm text-[#6B7280]">{formatDateTime(item.updatedAt)}</p>
                    </div>
                    <p className="mt-3 text-xl font-semibold text-[#111418]">{item.currentQuantity.toFixed(0)} portions</p>
                  </article>
                ))
              ) : (
                <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                  No finished stock has been recorded yet. Process a batch after roasting and packing to build frozen sellable stock.
                </div>
              )}
          </CollapsibleCard>

          <CollapsibleCard
            eyebrow="Processing History"
            title="Recent finished-stock batches"
            count={data.recentProcessingBatches.length}
            collapsedMessage="Expand this card when you need to review recent processing batches and yield details."
          >
              {data.recentProcessingBatches.length > 0 ? (
                data.recentProcessingBatches.map((batch) => (
                  <article key={batch.id} className="rounded-[22px] bg-[#F8FAFB] px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-[#111418]">{batch.portionName}</h3>
                        <p className="mt-1 text-sm text-[#6B7280]">{batch.receiptItemName}</p>
                        <p className="mt-1 text-sm text-[#6B7280]">
                          {batch.receiptSupplierName}
                          {batch.receiptBatchNumber ? ` | Batch ${batch.receiptBatchNumber}` : ""}
                        </p>
                      </div>
                      <p className="text-sm text-[#6B7280]">{formatDateTime(batch.createdAt)}</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[#6B7280]">
                      Added {batch.quantityProduced} finished portions into frozen stock
                    </p>
                    {batch.postRoastPackedWeightKg !== null ? (
                      <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                        Post-roast packed weight: {batch.postRoastPackedWeightKg.toFixed(3)} kg
                        {batch.rawWeightKg !== null ? ` from ${batch.rawWeightKg.toFixed(2)} kg raw` : ""}
                        {batch.yieldPercent !== null ? ` | Yield ${batch.yieldPercent.toFixed(2)}%` : ""}
                      </p>
                    ) : null}
                    {batch.note ? <p className="mt-2 text-sm leading-6 text-[#6B7280]">{batch.note}</p> : null}
                  </article>
                ))
              ) : (
                <div className="rounded-[22px] bg-[#F8FAFB] px-4 py-4 text-sm leading-6 text-[#6B7280]">
                  No processing batches have been recorded yet.
                </div>
              )}
          </CollapsibleCard>
        </aside>
      </div>
    </div>
  );
}
