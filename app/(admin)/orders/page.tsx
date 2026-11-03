import {OfflineOrders} from "@/components/orders/offline-orders";
import {OrdersHeader} from "@/components/orders/orders-header";
import { SchemaSetupNotice } from "@/components/admin/schema-setup-notice";
import { BusinessTruthHealthCard } from "@/components/orders/business-truth-health-card";
import { PushQueueHealthCard } from "@/components/orders/push-queue-health-card";
import { LiveOrdersPanel } from "@/components/orders/live-orders-panel";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { OperationsSchemaMissingError } from "@/lib/ops/errors";
import { getBusinessTruthHealthSnapshot, getOrdersPageData, getPushQueueSnapshots } from "@/lib/ops/queries";
import { processPendingPaymentRecoveriesAction } from "@/lib/ops/payment-recovery-actions";

function getFirstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrdersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = getFirstValue(params.status) ?? "all";
  const search = getFirstValue(params.search) ?? "";
  const page = Math.max(1, parseInt(getFirstValue(params.page) ?? "1", 10) || 1);
  const pushQueueStatus = getFirstValue(params.push_queue_status);
  const pushQueueMessage = getFirstValue(params.push_queue_message);
  const adminProfile = await requireApprovedAdminRole();
  const canViewBusinessTruthHealth = adminProfile.role === "admin" || adminProfile.role === "manager";
  let data;
  let pushQueues;
  let businessTruthHealth = null;

  try {
    [data, pushQueues, businessTruthHealth] = await Promise.all([
      getOrdersPageData({ status, search, page }),
      getPushQueueSnapshots(),
      canViewBusinessTruthHealth ? getBusinessTruthHealthSnapshot() : Promise.resolve(null)
    ]);
  } catch (error) {
    if (error instanceof OperationsSchemaMissingError) {
      return <SchemaSetupNotice title="Orders cannot load yet" error={error} />;
    }

    throw error;
  }

  const { orders, limit, page: currentPage, hasNextPage } = data;
  const returnToParams = new URLSearchParams();
  if (status !== "all") {
    returnToParams.set("status", status);
  }
  if (search) {
    returnToParams.set("search", search);
  }
  const returnTo = returnToParams.size > 0 ? `/orders?${returnToParams.toString()}` : "/orders";

  return (
    <div className="space-y-4 text-[#111418]">
      <OrdersHeader status={status} search={search} recoveryForm={<form action={processPendingPaymentRecoveriesAction}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                type="submit"
                className="rounded-2xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold text-[#111418]"
              >
                Recover payments
              </button>
            </form>}/>

      {process.env.OFFLINE_ORDERS_ENABLED==="true"&&/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.POS_HARDWARE_BRIDGE_URL||"")?<OfflineOrders userId={adminProfile.userId} bridgeUrl={process.env.POS_HARDWARE_BRIDGE_URL!}/>:null}
      {pushQueueMessage ? (
        <section
          className={`rounded-[24px] px-4 py-4 text-sm leading-6 ${
            pushQueueStatus === "error"
              ? "border border-[#F7D2B1] bg-[#FFF9F2] text-[#8A3F16]"
              : "border border-[#D7E8DA] bg-[#F4FBF5] text-[#166534]"
          }`}
        >
          {pushQueueMessage}
        </section>
      ) : null}

      <PushQueueHealthCard queues={pushQueues} returnTo={returnTo} />
      {businessTruthHealth ? <BusinessTruthHealthCard snapshot={businessTruthHealth} /> : null}
      <LiveOrdersPanel orders={orders} status={status} search={search} limit={limit} page={currentPage} hasNextPage={hasNextPage} />
    </div>
  );
}
