import { OfflineStation } from "@/components/pos/offline-station";
import { offlinePosEnabled } from "@/lib/pos/offline-grant";
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
    <>
    {offlinePosEnabled() && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.POS_HARDWARE_BRIDGE_URL || "") ? <OfflineStation cashierId={actor.userId} bridgeUrl={process.env.POS_HARDWARE_BRIDGE_URL!} /> : null}
    <PosSaleWorkspace
      cashierEmail={actor.email}
      cashierId={actor.userId}
      menuItems={menuItems}
      onlineReceiptPrintBacklog={onlineReceiptPrintBacklog}
      canRecordSales
    />
    </>
  );
}
