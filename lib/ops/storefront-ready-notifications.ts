import "server-only";

import { signInternalRequestToken } from "@/lib/internal-auth";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

type ReadyOrder = {
  id: number;
  status: string | null;
  updated_at: string | null;
};

type ReadyNotificationResult = {
  attempted: boolean;
  queued: boolean;
  duplicate: boolean;
  kickoffAccepted: boolean;
};

const READY_PROCESS_PURPOSE = "storefront_order_ready_process";
const READY_DUE_PROCESS_PURPOSE = "storefront_order_ready_process_due";
const STOREFRONT_READY_NOTIFICATION_TIMEOUT_MS = 8_000;
const STOREFRONT_READY_DUE_PROCESS_PATH = "/api/internal/push/order-ready/process-due";

export type StorefrontReadyQueueProcessResult = {
  configured: boolean;
  accepted: boolean;
  stats: {
    scanned: number;
    processed: number;
    completed: number;
    retried: number;
    failed: number;
  } | null;
};

function normalizeStatus(status: string | null | undefined) {
  return status?.trim().toLowerCase() ?? "";
}

function buildIdempotencyKey(order: { id: number; updatedAt: string }) {
  return `order-ready:${order.id}:${order.updatedAt}`;
}

function getStorefrontBaseUrl() {
  return process.env.STOREFRONT_BASE_URL?.trim().replace(/\/+$/, "") || null;
}

function getStorefrontSigningSecret() {
  return process.env.STOREFRONT_INTERNAL_AUTH_TOKEN?.trim() || null;
}

export function isStorefrontReadyNotificationKickoffConfigured() {
  return Boolean(getStorefrontBaseUrl() && getStorefrontSigningSecret());
}

async function enqueueReadyNotification(order: { id: number; updatedAt: string }) {
  const idempotencyKey = buildIdempotencyKey(order);
  const { error } = await createAdminSupabaseClient()
    .from("push_notification_dispatches")
    .insert({
      idempotency_key: idempotencyKey,
      notification_type: "order_ready",
      order_id: order.id,
      order_updated_at: order.updatedAt,
      source: "admin_order_status_action",
      next_attempt_at: new Date().toISOString()
    });

  if (!error) {
    return { duplicate: false, idempotencyKey };
  }

  if (error.code === "23505") {
    return { duplicate: true, idempotencyKey };
  }

  throw new Error(`Unable to enqueue storefront ready notification: ${error.message}`);
}

function buildKickoffRequest(order: { id: number; updatedAt: string }) {
  const baseUrl = getStorefrontBaseUrl();
  const secret = getStorefrontSigningSecret();
  if (!baseUrl || !secret) {
    return null;
  }

  const idempotencyKey = buildIdempotencyKey(order);
  const path = "/api/internal/push/order-ready/process";
  const token = signInternalRequestToken({
    secret,
    issuer: "thesmokehouse-admin",
    audience: "thesmokehouse-storefront",
    purpose: READY_PROCESS_PURPOSE,
    method: "POST",
    path,
    idempotencyKey
  });

  return {
    url: `${baseUrl}${path}`,
    idempotencyKey,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ idempotencyKey }),
      cache: "no-store" as const,
      signal: AbortSignal.timeout(STOREFRONT_READY_NOTIFICATION_TIMEOUT_MS)
    }
  };
}

function buildDueProcessRequest(limit: number) {
  const baseUrl = getStorefrontBaseUrl();
  const secret = getStorefrontSigningSecret();
  if (!baseUrl || !secret) {
    return null;
  }

  const token = signInternalRequestToken({
    secret,
    issuer: "thesmokehouse-admin",
    audience: "thesmokehouse-storefront",
    purpose: READY_DUE_PROCESS_PURPOSE,
    method: "POST",
    path: STOREFRONT_READY_DUE_PROCESS_PATH
  });

  return {
    url: `${baseUrl}${STOREFRONT_READY_DUE_PROCESS_PATH}`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ limit }),
      cache: "no-store" as const,
      signal: AbortSignal.timeout(STOREFRONT_READY_NOTIFICATION_TIMEOUT_MS)
    }
  };
}

export function didTransitionToReady(input: {
  requestedStatus: string;
  order: ReadyOrder | null;
}) {
  return (
    normalizeStatus(input.requestedStatus) === "ready"
    && normalizeStatus(input.order?.status) === "ready"
    && typeof input.order?.updated_at === "string"
  );
}

export async function triggerStorefrontReadyNotification(order: {
  id: number;
  updatedAt: string;
}): Promise<ReadyNotificationResult> {
  let enqueueResult: Awaited<ReturnType<typeof enqueueReadyNotification>> | null = null;

  try {
    enqueueResult = await enqueueReadyNotification(order);
  } catch (error) {
    console.error("storefront_ready_notification_enqueue_failed", {
      orderId: order.id,
      error: error instanceof Error ? error.message : "unknown_error"
    });

    return {
      attempted: true,
      queued: false,
      duplicate: false,
      kickoffAccepted: false
    };
  }

  const request = buildKickoffRequest(order);
  if (!request) {
    console.warn("storefront_ready_notification_kickoff_not_configured", {
      orderId: order.id
    });

    return {
      attempted: true,
      queued: true,
      duplicate: enqueueResult.duplicate,
      kickoffAccepted: false
    };
  }

  try {
    const response = await fetch(request.url, request.init);
    if (!response.ok) {
      console.error("storefront_ready_notification_kickoff_failed", {
        orderId: order.id,
        status: response.status
      });
    }

    return {
      attempted: true,
      queued: true,
      duplicate: enqueueResult.duplicate,
      kickoffAccepted: response.ok
    };
  } catch (error) {
    console.error("storefront_ready_notification_kickoff_error", {
      orderId: order.id,
      error: error instanceof Error ? error.message : "unknown_error"
    });

    return {
      attempted: true,
      queued: true,
      duplicate: enqueueResult.duplicate,
      kickoffAccepted: false
    };
  }
}

export async function triggerStorefrontReadyQueueProcessing(limit = 5): Promise<StorefrontReadyQueueProcessResult> {
  const normalizedLimit = Math.max(1, Math.min(10, Math.trunc(limit)));
  const request = buildDueProcessRequest(normalizedLimit);
  if (!request) {
    console.warn("storefront_ready_due_process_not_configured", {
      limit: normalizedLimit
    });

    return {
      configured: false,
      accepted: false,
      stats: null
    };
  }

  try {
    const response = await fetch(request.url, request.init);
    const payload = (await response.json().catch(() => null)) as
      | {
          accepted?: boolean;
          stats?: StorefrontReadyQueueProcessResult["stats"];
          message?: string;
        }
      | null;

    if (!response.ok) {
      throw new Error(payload?.message ?? `Storefront ready queue request failed with ${response.status}.`);
    }

    return {
      configured: true,
      accepted: Boolean(payload?.accepted),
      stats: payload?.stats ?? null
    };
  } catch (error) {
    console.error("storefront_ready_due_process_failed", {
      limit: normalizedLimit,
      error: error instanceof Error ? error.message : "unknown_error"
    });

    return {
      configured: true,
      accepted: false,
      stats: null
    };
  }
}
