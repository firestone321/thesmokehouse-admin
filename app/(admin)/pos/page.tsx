import Link from "next/link";
import { requirePosAccess } from "@/lib/auth/admin-role";
import { getOnlineReceiptPrintBacklogSnapshot } from "@/lib/ops/queries";
import { getPosMenuItems } from "@/lib/pos/queries";
import { PosSaleWorkspace } from "@/components/pos/pos-sale-workspace";

export default async function PosPage() {
  const [actor, menuItems, onlineReceiptPrintBacklog] = await Promise.all([
    requirePosAccess(),
    getPosMenuItems(),
    getOnlineReceiptPrintBacklogSnapshot()
  ]);

  return (
    <div className="space-y-4">
      <Link href="/pos/travellers" className="inline-flex rounded-xl border border-[#D7DDE4] bg-white px-4 py-2 text-sm font-semibold text-[#111418]">Traveller preorders and arrivals</Link>
      <PosSaleWorkspace
        cashierEmail={actor.email}
        menuItems={menuItems}
        onlineReceiptPrintBacklog={onlineReceiptPrintBacklog}
        canRecordSales
      />
    </div>
  );
}
