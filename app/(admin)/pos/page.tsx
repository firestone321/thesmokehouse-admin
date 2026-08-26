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
    <PosSaleWorkspace
      cashierEmail={actor.email}
      menuItems={menuItems}
      onlineReceiptPrintBacklog={onlineReceiptPrintBacklog}
      canRecordSales
    />
  );
}
