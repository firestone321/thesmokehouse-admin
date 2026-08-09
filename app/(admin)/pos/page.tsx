import { requirePosAccess } from "@/lib/auth/admin-role";
import { getPosMenuItems } from "@/lib/pos/queries";
import { PosSaleWorkspace } from "@/components/pos/pos-sale-workspace";

export default async function PosPage() {
  const [actor, menuItems] = await Promise.all([requirePosAccess(), getPosMenuItems()]);

  return <PosSaleWorkspace cashierEmail={actor.email} menuItems={menuItems} />;
}
