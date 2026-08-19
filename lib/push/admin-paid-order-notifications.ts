import "server-only";

import { createHash, randomUUID } from "node:crypto";
import webpush from "web-push";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { requireEnv } from "@/lib/supabase/shared";

const ADMIN_PAID_ORDER_NOTIFICATION_TYPE = "new_paid_order";
const CHEF_IN_PREP_NOTIFICATION_TYPE = "order_in_prep";
const ADMIN_PAID_ORDER_RECIPIENT_ROLES = ["admin", "manager", "chef", "staff"] as const;
const MAX_DISPATCH_BATCH_SIZE = 25;
const MAX_DISPATCH_ATTEMPTS = 6;
const NO_SUBSCRIBER_RETRY_DELAY_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000];
const MAX_ACTIVE_SUBSCRIPTIONS = 10;
const SEND_CONCURRENCY = 5;
const DISPATCH_CONCURRENCY = 3;
const ADMIN_PUSH_DRAIN_LOCK_TTL_SECONDS = 60;
const MAX_PUSH_TOPIC_LENGTH = 32;

type AdminPushNotificationType =
  | typeof ADMIN_PAID_ORDER_NOTIFICATION_TYPE
  | typeof CHEF_IN_PREP_NOTIFICATION_TYPE;

function buildPushTopic(tag: string) {
  // Apple Web Push rejects Topic headers that are not valid base64url-decodable
  // strings (responds 400 BadWebPushTopic). Hashing the tag and base64url-encoding
  // the digest produces a deterministic, always-valid topic for every provider.
  return createHash("sha256")
    .update(tag, "utf8")
    .digest("base64url")
    .slice(0, MAX_PUSH_TOPIC_LENGTH);
}

type AdminPushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  is_pos_print_station: boolean;
};

type AdminPushDispatchRow = {
  id: string;
  order_id: number;
  notification_type: AdminPushNotificationType;
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

type ProcessDispatchResult = Pick<
  AdminPushQueueStats,
  | "succeeded"
  | "retried"
  | "failed"
  | "noSubscribers"
  | "subscriptionsDelivered"
  | "subscriptionsExpired"
  | "subscriptionFailures"
>;

type SubscriptionDeliveryResult = {
  delivered: number;
  expired: number;
  retryableFailures: number;
  lastRetryableError: string | null;
};

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

function createEmptyProcessDispatchResult(): ProcessDispatchResult {
  return {
    succeeded: 0,
    retried: 0,
    failed: 0,
    noSubscribers: 0,
    subscriptionsDelivered: 0,
    subscriptionsExpired: 0,
    subscriptionFailures: 0
  };
}

function getLastRetryableError(results: SubscriptionDeliveryResult[]) {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const error = results[index].lastRetryableError;
    if (error !== null) {
      return error;
    }
  }

  return null;
}

async function runLimited<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(Math.trunc(concurrency), items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    })
  );

  return results;
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

function buildAdminOrderNotificationPayload(
  order: AdminPushOrderSummary,
  notificationType: AdminPushNotificationType,
  onlineReceiptPrintJobId?: string | null
) {
  const actorLabel = getOrderActorLabel(order);

  if (notificationType === CHEF_IN_PREP_NOTIFICATION_TYPE) {
    return {
      title: "Order moved to In Prep",
      body: actorLabel
        ? `${order.order_number} for ${actorLabel} is ready for the kitchen`
        : `${order.order_number} is ready for the kitchen`,
      tag: `chef-order-in-prep:${order.id}`,
      data: {
        orderId: order.id,
        url: `/orders/${order.id}`,
        eventType: CHEF_IN_PREP_NOTIFICATION_TYPE
      }
    };
  }

  const data: {
    orderId: number;
    url: string;
    eventType: typeof ADMIN_PAID_ORDER_NOTIFICATION_TYPE;
    onlineReceiptPrintJobId?: string;
  } = {
    orderId: order.id,
    url: `/orders/${order.id}`,
    eventType: ADMIN_PAID_ORDER_NOTIFICATION_TYPE
  };
  if (onlineReceiptPrintJobId) {
    data.onlineReceiptPrintJobId = onlineReceiptPrintJobId;
  }

  return {
    title: "New paid order received",
    body: actorLabel ? `${order.order_number} from ${actorLabel}` : `${order.order_number} is ready for review`,
    tag: `admin-new-paid-order:${order.id}`,
    data
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

async function listAdminPushSubscriptions(notificationType: AdminPushNotificationType) {
  const supabaseAdmin = createAdminSupabaseClient();
  const recipientRoles =
    notificationType === CHEF_IN_PREP_NOTIFICATION_TYPE
      ? ["chef"]
      : [...ADMIN_PAID_ORDER_RECIPIENT_ROLES];
  const { data: recipientProfiles, error: recipientProfilesError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .in("role", recipientRoles);

  if (recipientProfilesError) {
    throw new Error(`Unable to load eligible profiles for admin push: ${recipientProfilesError.message}`);
  }

  const recipientProfileIds = (recipientProfiles ?? []).map((profile) => profile.id);
  if (recipientProfileIds.length === 0) {
    return [];
  }

  const query = supabaseAdmin
    .from("admin_push_subscriptions")
    .select("id,endpoint,p256dh,auth,is_pos_print_station")
    .in("owner_profile_id", recipientProfileIds)
    .order("last_seen_at", { ascending: false })
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  const { data, error } = await query.limit(MAX_ACTIVE_SUBSCRIPTIONS);

  if (error) {
    throw new Error(`Unable to load admin push subscriptions: ${error.message}`);
  }

  return (data ?? []) as AdminPushSubscriptionRow[];
}

async function loadOnlineReceiptPrintJobId(orderId: number): Promise<string | null> {
  const supabaseAdmin = createAdminSupabaseClient();
  const { data, error } = await supabaseAdmin
    .from("online_receipt_print_jobs")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load paid-order receipt print job: ${error.message}`);
  }

  return typeof data?.id === "string" ? data.id : null;
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
  payload: ReturnType<typeof buildAdminOrderNotificationPayload>
): Promise<PushSendOutcome> {
  try {
    webpush.setVapidDetails(
      requireEnv("VAPID_SUBJECT", "WEB_PUSH_VAPID_SUBJECT"),
      requireEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY"),
      requireEnv("VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY")
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
        topic: buildPushTopic(`${payload.data.eventType}-${payload.data.orderId}`)
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

    return { ...createEmptyProcessDispatchResult(), failed: 1 };
  }

  const subscriptions = await listAdminPushSubscriptions(dispatch.notification_type);
  const receipts = await listDispatchReceipts(dispatch.id);
  const deliveredSubscriptionIds = new Set(receipts.map((receipt) => receipt.subscription_id));
  const pendingSubscriptions = subscriptions.filter((subscription) => !deliveredSubscriptionIds.has(subscription.id));

  if (subscriptions.length === 0) {
    await updateDispatchState(dispatch.id, {
      status: "no_subscribers",
      next_attempt_at: new Date(Date.now() + NO_SUBSCRIBER_RETRY_DELAY_MS).toISOString(),
      completed_at: null,
      last_error: "no_active_subscriptions"
    });

    return { ...createEmptyProcessDispatchResult(), noSubscribers: 1 };
  }

  if (pendingSubscriptions.length === 0) {
    await updateDispatchState(dispatch.id, {
      status: "succeeded",
      completed_at: new Date().toISOString(),
      last_error: null
    });

    return { ...createEmptyProcessDispatchResult(), succeeded: 1 };
  }

  const onlineReceiptPrintJobId = dispatch.notification_type === ADMIN_PAID_ORDER_NOTIFICATION_TYPE
    ? await loadOnlineReceiptPrintJobId(order.id)
    : null;
  const deliveryResults = await runLimited(
    pendingSubscriptions,
    SEND_CONCURRENCY,
    async (subscription): Promise<SubscriptionDeliveryResult> => {
      try {
        const payload = buildAdminOrderNotificationPayload(
          order,
          dispatch.notification_type,
          subscription.is_pos_print_station ? onlineReceiptPrintJobId : null
        );
        const result = await sendPushNotification(subscription, payload);

        if (result.status === "sent") {
          await recordDispatchReceipt(dispatch.id, subscription.id);
          return { delivered: 1, expired: 0, retryableFailures: 0, lastRetryableError: null };
        }

        if (result.status === "invalid") {
          await deleteExpiredSubscription(subscription.id);
          return { delivered: 0, expired: 1, retryableFailures: 0, lastRetryableError: null };
        }

        console.error("admin_paid_order_push_send_failed", {
          dispatchId: dispatch.id,
          orderId: dispatch.order_id,
          subscriptionId: subscription.id,
          error: result.error
        });

        return { delivered: 0, expired: 0, retryableFailures: 1, lastRetryableError: result.error };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown_error";
        console.error("admin_paid_order_push_delivery_record_failed", {
          dispatchId: dispatch.id,
          orderId: dispatch.order_id,
          subscriptionId: subscription.id,
          error: errorMessage
        });

        return { delivered: 0, expired: 0, retryableFailures: 1, lastRetryableError: errorMessage };
      }
    }
  );

  const deliveredCount = deliveryResults.reduce((total, result) => total + result.delivered, 0);
  const expiredCount = deliveryResults.reduce((total, result) => total + result.expired, 0);
  const retryableFailureCount = deliveryResults.reduce((total, result) => total + result.retryableFailures, 0);
  const lastRetryableError = getLastRetryableError(deliveryResults);

  if (retryableFailureCount > 0) {
    if (dispatch.attempt_count >= MAX_DISPATCH_ATTEMPTS) {
      await updateDispatchState(dispatch.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        last_error: lastRetryableError ?? "push_delivery_failed"
      });

      return {
        ...createEmptyProcessDispatchResult(),
        failed: 1,
        subscriptionsDelivered: deliveredCount,
        subscriptionsExpired: expiredCount,
        subscriptionFailures: retryableFailureCount
      };
    }

    await updateDispatchState(dispatch.id, {
      status: "pending",
      next_attempt_at: new Date(Date.now() + getRetryDelayMs(dispatch.attempt_count)).toISOString(),
      completed_at: null,
      last_error: lastRetryableError ?? "push_delivery_failed"
    });

    return {
      ...createEmptyProcessDispatchResult(),
      retried: 1,
      subscriptionsDelivered: deliveredCount,
      subscriptionsExpired: expiredCount,
      subscriptionFailures: retryableFailureCount
    };
  }

  await updateDispatchState(dispatch.id, {
    status: "succeeded",
    completed_at: new Date().toISOString(),
    last_error: null
  });

  return {
    ...createEmptyProcessDispatchResult(),
    succeeded: 1,
    subscriptionsDelivered: deliveredCount,
    subscriptionsExpired: expiredCount
  };
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

  const results = await runLimited(claimedDispatches, DISPATCH_CONCURRENCY, processDispatch);

  for (const result of results) {
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

export async function runAdminPushDrainWithLock(
  work: () => Promise<void>
): Promise<{ acquired: boolean }> {
  const supabase = createAdminSupabaseClient();
  const holder = randomUUID();

  const { data: acquired, error: lockError } = await supabase.rpc("try_acquire_admin_push_drain_lock", {
    p_holder: holder,
    p_ttl_seconds: ADMIN_PUSH_DRAIN_LOCK_TTL_SECONDS
  });

  if (lockError) {
    console.error("admin_push_drain_lock_acquire_failed", { error: lockError.message });
    return { acquired: false };
  }

  if (acquired !== true) {
    return { acquired: false };
  }

  try {
    await work();
  } finally {
    const { error: releaseError } = await supabase.rpc("release_admin_push_drain_lock", {
      p_holder: holder
    });
    if (releaseError) {
      console.error("admin_push_drain_lock_release_failed", { error: releaseError.message });
    }
  }

  return { acquired: true };
}

export async function reopenNoSubscriberAdminPushDispatches(limit = 10) {
  const supabaseAdmin = createAdminSupabaseClient();
  const { data, error } = await supabaseAdmin
    .from("admin_push_dispatches")
    .select("id")
    .eq("status", "no_subscribers")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(25, Math.trunc(limit))));

  if (error) {
    throw new Error(`Unable to load no-subscriber admin push dispatches: ${error.message}`);
  }

  const dispatchIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (dispatchIds.length === 0) {
    return 0;
  }

  const { error: updateError } = await supabaseAdmin
    .from("admin_push_dispatches")
    .update({
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      completed_at: null,
      last_error: "subscriber_available_retry"
    })
    .in("id", dispatchIds);

  if (updateError) {
    throw new Error(`Unable to reopen no-subscriber admin push dispatches: ${updateError.message}`);
  }

  return dispatchIds.length;
}
