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
const STOREFRONT_READY_NOTIFICATION_TIMEOUT_MS = 8_000;

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
