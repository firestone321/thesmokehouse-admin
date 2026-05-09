"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { signInternalRequestToken } from "@/lib/internal-auth";
import { getStorefrontSigningSecret, getValidatedStorefrontBaseUrl } from "@/lib/ops/storefront-config";
import { reverifyOrderPaymentActionSchema } from "@/lib/schemas/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { parseFormData } from "@/lib/validation/form-data";

type PaymentAuthorityResponse =
  | {
      ok?: boolean;
      verificationState?: string;
      message?: string;
    }
  | null;

const PAYMENT_VERIFY_PURPOSE = "payment_authority_verify";
const PAYMENT_VERIFY_TIMEOUT_MS = 8_000;

function revalidateOrderPaths(orderId: number | string) {
  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath("/orders/history");
  revalidatePath(`/orders/${orderId}`);
  revalidateTag("business-truth-health-snapshot", "max");
}

async function askStorefrontToReverifyPayment(orderId: number) {
  const baseUrl = getValidatedStorefrontBaseUrl();
  const secret = getStorefrontSigningSecret();
  if (!baseUrl || !secret) {
    throw new Error("Storefront payment verification is not configured yet.");
  }

  const path = `/api/internal/payments/orders/${orderId}/verify`;
  const token = signInternalRequestToken({
    secret,
    issuer: "thesmokehouse-admin",
    audience: "thesmokehouse-storefront",
    purpose: PAYMENT_VERIFY_PURPOSE,
    method: "POST",
    path,
    orderId: String(orderId)
  });

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    },
    cache: "no-store",
    signal: AbortSignal.timeout(PAYMENT_VERIFY_TIMEOUT_MS)
  });
  const payload = (await response.json().catch(() => null)) as PaymentAuthorityResponse;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? `Storefront payment verification failed with ${response.status}.`);
  }

  return payload.verificationState?.trim().toLowerCase() || "pending";
}

export async function reverifyOrderPaymentAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, reverifyOrderPaymentActionSchema);
  const supabase = createAdminSupabaseClient();
  const orderId = input.order_id;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,order_tracking_id")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    throw new Error(`Unable to load order for payment reverify: ${orderError.message}`);
  }

  if (!order) {
    redirect(`/orders/${orderId}?error=${encodeURIComponent("That order could not be found.")}`);
  }

  if (!order.order_tracking_id) {
    redirect(`/orders/${orderId}?error=${encodeURIComponent("This order does not have a Pesapal tracking ID to reverify.")}`);
  }

  let verificationState: string;
  try {
    verificationState = await askStorefrontToReverifyPayment(orderId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reverify payment through the storefront.";
    redirect(`/orders/${orderId}?error=${encodeURIComponent(message)}`);
  }

  revalidateOrderPaths(orderId);
  redirect(`/orders/${orderId}?payment_reverified=${encodeURIComponent(verificationState)}`);
}
