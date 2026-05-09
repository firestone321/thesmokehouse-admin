import "server-only";

import { signInternalRequestToken } from "@/lib/internal-auth";
import { getStorefrontSigningSecret, getValidatedStorefrontBaseUrl } from "@/lib/ops/storefront-config";

const PAYMENT_RECOVERY_PROCESS_PURPOSE = "storefront_pending_payment_recovery_process_due";
const STOREFRONT_PAYMENT_RECOVERY_PROCESS_PATH = "/api/internal/payments/recovery/process-due";
const STOREFRONT_PAYMENT_RECOVERY_TIMEOUT_MS = 10_000;

export type StorefrontPendingPaymentRecoveryStats = {
  trigger: string;
  trackedScanned: number;
  trackedClaimed: number;
  trackedVerified: number;
  trackedCancelled: number;
  trackedCompleted: number;
  trackedRescheduled: number;
  errors: string[];
};

export type StorefrontPendingPaymentRecoveryResult = {
  configured: boolean;
  accepted: boolean;
  stats: StorefrontPendingPaymentRecoveryStats | null;
};

function buildPaymentRecoveryRequest(limit: number) {
  let baseUrl: string | null = null;
  try {
    baseUrl = getValidatedStorefrontBaseUrl();
  } catch (error) {
    console.warn("storefront_pending_payment_recovery_invalid_config", {
      error: error instanceof Error ? error.message : "unknown_error"
    });
    return null;
  }

  const secret = getStorefrontSigningSecret();
  if (!baseUrl || !secret) {
    return null;
  }

  const token = signInternalRequestToken({
    secret,
    issuer: "thesmokehouse-admin",
    audience: "thesmokehouse-storefront",
    purpose: PAYMENT_RECOVERY_PROCESS_PURPOSE,
    method: "POST",
    path: STOREFRONT_PAYMENT_RECOVERY_PROCESS_PATH
  });

  return {
    url: `${baseUrl}${STOREFRONT_PAYMENT_RECOVERY_PROCESS_PATH}`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ limit }),
      cache: "no-store" as const,
      signal: AbortSignal.timeout(STOREFRONT_PAYMENT_RECOVERY_TIMEOUT_MS)
    }
  };
}

export async function triggerStorefrontPendingPaymentRecovery(limit = 10): Promise<StorefrontPendingPaymentRecoveryResult> {
  const normalizedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const request = buildPaymentRecoveryRequest(normalizedLimit);
  if (!request) {
    console.warn("storefront_pending_payment_recovery_not_configured", {
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
          stats?: StorefrontPendingPaymentRecoveryStats;
          message?: string;
        }
      | null;

    if (!response.ok) {
      throw new Error(payload?.message ?? `Storefront payment recovery request failed with ${response.status}.`);
    }

    return {
      configured: true,
      accepted: Boolean(payload?.accepted),
      stats: payload?.stats ?? null
    };
  } catch (error) {
    console.error("storefront_pending_payment_recovery_failed", {
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
