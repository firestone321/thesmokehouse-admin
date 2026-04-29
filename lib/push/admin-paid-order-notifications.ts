import "server-only";

import webpush from "web-push";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { requireEnv } from "@/lib/supabase/shared";

const ADMIN_PAID_ORDER_NOTIFICATION_TYPE = "new_paid_order";
const MAX_DISPATCH_BATCH_SIZE = 25;
const MAX_DISPATCH_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000];

type AdminPushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type AdminPushDispatchRow = {
  id: string;
  order_id: number;
  status: string;
  attempt_count: number;
};

type AdminPushReceiptRow = {
  subscription_id: string;
};

type AdminPushOrderSummary = {
  id: number;
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
};

type PushSendOutcome =
  | { status: "sent" }
  | { status: "invalid" }
  | { status: "retryable"; error: string };

export type AdminPushQueueStats = {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  noSubscribers: number;
  subscriptionsDelivered: number;
  subscriptionsExpired: number;
  subscriptionFailures: number;
  claimedDispatchIds: string[];
};

function isMissingClaimDispatchesRpcError(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("claim_admin_push_dispatches") && normalized.includes("schema cache");
}

function getRetryDelayMs(attemptCount: number) {
  return RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)];
}

function getOrderActorLabel(order: AdminPushOrderSummary) {
  const customerName = order.customer_name?.trim();
  if (customerName) {
    return customerName;
  }

  const phone = order.customer_phone?.trim();
  if (phone) {
    return phone;
  }

  return null;
}

function buildAdminPaidOrderNotificationPayload(order: AdminPushOrderSummary) {
  const actorLabel = getOrderActorLabel(order);

  return {
    title: "New paid order received",
    body: actorLabel ? `${order.order_number} from ${actorLabel}` : `${order.order_number} is ready for review`,
    tag: `admin-new-paid-order:${order.id}`,
    data: {
      orderId: order.id,
      url: `/orders/${order.id}`,
      eventType: ADMIN_PAID_ORDER_NOTIFICATION_TYPE
    }
  };
}

async function loadOrderSummary(orderId: number): Promise<AdminPushOrderSummary | null> {
  const supabaseAdmin = createAdminSupabaseClient();
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id,order_number,customer_name,customer_phone")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load order for admin push: ${error.message}`);
  }

  return (data ?? null) as AdminPushOrderSummary | null;
}

async function listAdminPushSubscriptions() {
  const supabaseAdmin = createAdminSupabaseClient();
  const { data, error } = await supabaseAdmin
    .from("admin_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Unable to load admin push subscriptions: ${error.message}`);
  }

  return (data ?? []) as AdminPushSubscriptionRow[];
}

async function listDispatchReceipts(dispatchId: string) {
  const supabaseAdmin = createAdminSupabaseClient();
  const { data, error } = await supabaseAdmin
    .from("admin_push_dispatch_receipts")
    .select("subscription_id")
    .eq("dispatch_id", dispatchId);

  if (error) {
    throw new Error(`Unable to load admin push receipts: ${error.message}`);
  }

  return (data ?? []) as AdminPushReceiptRow[];
}

async function deleteExpiredSubscription(subscriptionId: string) {
  const supabaseAdmin = createAdminSupabaseClient();
  const { error } = await supabaseAdmin.from("admin_push_subscriptions").delete().eq("id", subscriptionId);

  if (error) {
    console.error("admin_push_subscription_delete_failed", { subscriptionId, error: error.message });
  }
}

async function recordDispatchReceipt(dispatchId: string, subscriptionId: string) {
  const supabaseAdmin = createAdminSupabaseClient();
  const { error } = await supabaseAdmin.from("admin_push_dispatch_receipts").upsert(
    {
      dispatch_id: dispatchId,
      subscription_id: subscriptionId
    },
    {
      onConflict: "dispatch_id,subscription_id"
    }
  );

  if (error) {
    throw new Error(`Unable to record admin push receipt: ${error.message}`);
  }
}

async function updateDispatchState(dispatchId: string, values: Record<string, string | number | null>) {
  const supabaseAdmin = createAdminSupabaseClient();
  const { error } = await supabaseAdmin.from("admin_push_dispatches").update(values).eq("id", dispatchId);

  if (error) {
    throw new Error(`Unable to update admin push dispatch: ${error.message}`);
  }
}

async function claimDispatches(options?: { limit?: number; orderId?: number }) {
  const supabaseAdmin = createAdminSupabaseClient();
  const limit = Math.max(1, Math.min(MAX_DISPATCH_BATCH_SIZE, Math.trunc(options?.limit ?? 10)));
  const { data, error } = await supabaseAdmin.rpc("claim_admin_push_dispatches", {
    p_limit: limit,
    p_order_id: options?.orderId ?? null
  });

  if (error) {
    if (isMissingClaimDispatchesRpcError(error.message)) {
      console.warn("admin_push_dispatch_claim_rpc_missing", error.message);
      return [];
    }

    throw new Error(`Unable to claim admin push dispatches: ${error.message}`);
  }

  return (data ?? []) as AdminPushDispatchRow[];
}

async function sendPushNotification(
  subscription: AdminPushSubscriptionRow,
  payload: ReturnType<typeof buildAdminPaidOrderNotificationPayload>
): Promise<PushSendOutcome> {
  try {
    webpush.setVapidDetails(
      requireEnv("WEB_PUSH_VAPID_SUBJECT"),
      requireEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY"),
      requireEnv("WEB_PUSH_VAPID_PRIVATE_KEY")
    );

    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth
        }
      },
      JSON.stringify(payload),
      {
        TTL: 300,
        urgency: "high",
        topic: `paid-order-${String(payload.data.orderId).slice(0, 20)}`
      }
    );

    return { status: "sent" };
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : null;
    const errorMessage = error instanceof Error ? error.message : "unknown_error";

    if (statusCode === 404 || statusCode === 410) {
      return { status: "invalid" };
    }

    return { status: "retryable", error: errorMessage };
  }
}

async function processDispatch(dispatch: AdminPushDispatchRow) {
  const order = await loadOrderSummary(dispatch.order_id);

  if (!order) {
    await updateDispatchState(dispatch.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      last_error: "order_not_found"
    });

    return { succeeded: 0, retried: 0, failed: 1, noSubscribers: 0, subscriptionsDelivered: 0, subscriptionsExpired: 0, subscriptionFailures: 0 };
  }

  const subscriptions = await listAdminPushSubscriptions();
  const receipts = await listDispatchReceipts(dispatch.id);
  const deliveredSubscriptionIds = new Set(receipts.map((receipt) => receipt.subscription_id));
  const pendingSubscriptions = subscriptions.filter((subscription) => !deliveredSubscriptionIds.has(subscription.id));

  if (subscriptions.length === 0) {
    await updateDispatchState(dispatch.id, {
      status: "no_subscribers",
      completed_at: new Date().toISOString(),
      last_error: "no_active_subscriptions"
    });

    return { succeeded: 0, retried: 0, failed: 0, noSubscribers: 1, subscriptionsDelivered: 0, subscriptionsExpired: 0, subscriptionFailures: 0 };
  }

  if (pendingSubscriptions.length === 0) {
    await updateDispatchState(dispatch.id, {
      status: "succeeded",
      completed_at: new Date().toISOString(),
      last_error: null
    });

    return { succeeded: 1, retried: 0, failed: 0, noSubscribers: 0, subscriptionsDelivered: 0, subscriptionsExpired: 0, subscriptionFailures: 0 };
  }

  const payload = buildAdminPaidOrderNotificationPayload(order);
  let deliveredCount = 0;
  let expiredCount = 0;
  let retryableFailureCount = 0;
  let lastRetryableError: string | null = null;

  for (const subscription of pendingSubscriptions) {
    const result = await sendPushNotification(subscription, payload);

    if (result.status === "sent") {
      await recordDispatchReceipt(dispatch.id, subscription.id);
      deliveredCount += 1;
      continue;
    }

    if (result.status === "invalid") {
      expiredCount += 1;
      await deleteExpiredSubscription(subscription.id);
      continue;
    }

    retryableFailureCount += 1;
    lastRetryableError = result.error;
    console.error("admin_paid_order_push_send_failed", {
      dispatchId: dispatch.id,
      orderId: dispatch.order_id,
      subscriptionId: subscription.id,
      error: result.error
    });
  }

  if (retryableFailureCount > 0) {
    if (dispatch.attempt_count >= MAX_DISPATCH_ATTEMPTS) {
      await updateDispatchState(dispatch.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        last_error: lastRetryableError ?? "push_delivery_failed"
      });

      return { succeeded: 0, retried: 0, failed: 1, noSubscribers: 0, subscriptionsDelivered: deliveredCount, subscriptionsExpired: expiredCount, subscriptionFailures: retryableFailureCount };
    }

    await updateDispatchState(dispatch.id, {
      status: "pending",
      next_attempt_at: new Date(Date.now() + getRetryDelayMs(dispatch.attempt_count)).toISOString(),
      completed_at: null,
      last_error: lastRetryableError ?? "push_delivery_failed"
    });

    return { succeeded: 0, retried: 1, failed: 0, noSubscribers: 0, subscriptionsDelivered: deliveredCount, subscriptionsExpired: expiredCount, subscriptionFailures: retryableFailureCount };
  }

  await updateDispatchState(dispatch.id, {
    status: "succeeded",
    completed_at: new Date().toISOString(),
    last_error: null
  });

  return { succeeded: 1, retried: 0, failed: 0, noSubscribers: 0, subscriptionsDelivered: deliveredCount, subscriptionsExpired: expiredCount, subscriptionFailures: 0 };
}

export async function processAdminPushDispatchQueue(options?: { limit?: number; orderId?: number }): Promise<AdminPushQueueStats> {
  const claimedDispatches = await claimDispatches(options);
  const stats: AdminPushQueueStats = {
    claimed: claimedDispatches.length,
    succeeded: 0,
    retried: 0,
    failed: 0,
    noSubscribers: 0,
    subscriptionsDelivered: 0,
    subscriptionsExpired: 0,
    subscriptionFailures: 0,
    claimedDispatchIds: claimedDispatches.map((dispatch) => dispatch.id)
  };

  for (const dispatch of claimedDispatches) {
    const result = await processDispatch(dispatch);
    stats.succeeded += result.succeeded;
    stats.retried += result.retried;
    stats.failed += result.failed;
    stats.noSubscribers += result.noSubscribers;
    stats.subscriptionsDelivered += result.subscriptionsDelivered;
    stats.subscriptionsExpired += result.subscriptionsExpired;
    stats.subscriptionFailures += result.subscriptionFailures;
  }

  console.info("admin_push_dispatch_queue_processed", stats);
  return stats;
}
