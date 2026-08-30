import { recordFinancialTransferAction } from "@/lib/financial-transfers/actions";
import type { FinancialAccount, FinancialTransfer } from "@/lib/financial-transfers/types";
import { formatCurrency, formatDateTime } from "@/lib/ops/utils";

export function FinancialTransfers({
  accounts,
  transfers,
  summary,
  idempotencyKey,
  defaultTransferredAt,
  canRecord,
  message
}: {
  accounts: FinancialAccount[];
  transfers: FinancialTransfer[];
  summary: { transferCount: number; totalTransferredUgx: number; cashToMobileMoneyUgx: number };
  idempotencyKey: string;
  defaultTransferredAt: string;
  canRecord: boolean;
  message?: string;
}) {
  const cash = accounts.find((account) => account.accountType === "cash");
  const mobileMoney = accounts.find((account) => account.accountType === "mobile_money");

  return <section className="surface-card rounded-[32px] p-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Internal transfers</p><h2 className="mt-2 text-xl font-semibold">Deposits and money location</h2><p className="mt-2 text-sm text-[#6B7280]">Transfers move business money between locations. They are not Money In or Money Out.</p></div>
      <div className="text-right text-sm"><p className="font-semibold">{summary.transferCount} transfers</p><p className="text-[#6B7280]">Cash → Mobile Money: {formatCurrency(summary.cashToMobileMoneyUgx)}</p></div>
    </div>
    {message ? <p className="mt-4 rounded-[18px] border border-[#D8E1F4] bg-[#F5F8FF] px-4 py-3 text-sm text-[#46699B]">{message}</p> : null}
    {canRecord ? <form action={recordFinancialTransferAction} className="mt-5 rounded-[24px] border border-[#E4E7EB] bg-[#F8FAFB] p-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <p className="text-sm font-semibold">Record Deposit</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-sm font-semibold">From account<select name="fromAccountId" defaultValue={cash?.id} required className="rounded-xl border border-[#D9E0E6] bg-white px-3 py-2 font-normal">{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">To account<select name="toAccountId" defaultValue={mobileMoney?.id} required className="rounded-xl border border-[#D9E0E6] bg-white px-3 py-2 font-normal">{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Amount (UGX)<input name="amountUgx" inputMode="numeric" required className="rounded-xl border border-[#D9E0E6] bg-white px-3 py-2 font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold">Date and time<input name="transferredAt" type="datetime-local" defaultValue={defaultTransferredAt} required className="rounded-xl border border-[#D9E0E6] bg-white px-3 py-2 font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold">Reference<input name="externalReference" maxLength={255} placeholder="e.g. MM-123456" className="rounded-xl border border-[#D9E0E6] bg-white px-3 py-2 font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold">Deposit fee (UGX)<input name="feeAmountUgx" inputMode="numeric" defaultValue="0" className="rounded-xl border border-[#D9E0E6] bg-white px-3 py-2 font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold md:col-span-2">Notes<input name="notes" maxLength={2000} className="rounded-xl border border-[#D9E0E6] bg-white px-3 py-2 font-normal" /></label>
      </div>
      <p className="mt-3 text-xs text-[#6B7280]">A fee is posted separately as one cash Money Out transaction. The transfer amount remains unchanged.</p>
      <button className="mt-4 rounded-full bg-[#5E2519] px-5 py-2.5 text-sm font-semibold text-white">Record Deposit</button>
    </form> : null}
    <div className="mt-5 overflow-x-auto rounded-[20px] border border-[#E4E7EB]">
      <table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-[#F8FAFB] text-xs uppercase tracking-[0.12em] text-[#6B7280]"><tr><th className="px-3 py-3">Date</th><th className="px-3 py-3">From</th><th className="px-3 py-3">To</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3">Reference</th><th className="px-3 py-3">Entered by</th><th className="px-3 py-3">Notes</th></tr></thead>
        <tbody>{transfers.map((transfer) => <tr key={transfer.id} className="border-t border-[#EEF2F6]"><td className="px-3 py-3">{formatDateTime(transfer.transferredAt)}</td><td className="px-3 py-3 font-semibold">{transfer.fromAccount}</td><td className="px-3 py-3 font-semibold">{transfer.toAccount}</td><td className="px-3 py-3 text-right">{formatCurrency(transfer.amountUgx)}</td><td className="px-3 py-3">{transfer.externalReference ?? "—"}</td><td className="px-3 py-3 text-xs">{transfer.createdBy}</td><td className="px-3 py-3">{transfer.notes ?? "—"}{transfer.feeAmountUgx > 0 ? <span className="block text-xs text-[#9A6A1B]">Fee: {formatCurrency(transfer.feeAmountUgx)}</span> : null}</td></tr>)}</tbody>
      </table>
      {transfers.length === 0 ? <p className="px-4 py-5 text-sm text-[#6B7280]">No internal transfers recorded yet.</p> : null}
    </div>
    <p className="mt-3 text-xs text-[#6B7280]">Total internal movement shown for the report period: {formatCurrency(summary.totalTransferredUgx)}. This does not change Net Cash Movement.</p>
  </section>;
}
