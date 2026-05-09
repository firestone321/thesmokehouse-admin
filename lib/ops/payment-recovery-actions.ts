"use server";

import { redirect } from "next/navigation";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { triggerStorefrontPendingPaymentRecovery } from "@/lib/ops/storefront-payment-recovery";

function buildOrdersFlashRedirect(returnTo: string, status: "success" | "error", message: string) {
  const url = new URL(returnTo, "http://smokehouse.local");
  url.searchParams.set("push_queue_status", status);
  url.searchParams.set("push_queue_message", message);
  return `${url.pathname}${url.search}${url.hash}`;
}

function parseReturnTo(formData: FormData) {
  const raw = formData.get("returnTo");
  if (typeof raw !== "string" || !raw.startsWith("/orders")) {
    return "/orders";
  }

  return raw;
}

export async function processPendingPaymentRecoveriesAction(formData: FormData) {
  await requireApprovedAdminRole();

  const returnTo = parseReturnTo(formData);
  const result = await triggerStorefrontPendingPaymentRecovery(10);

  if (!result.configured) {
    redirect(
      buildOrdersFlashRedirect(
        returnTo,
        "error",
        "Payment recovery is not configured. Set STOREFRONT_BASE_URL, EXPECTED_STOREFRONT_HOSTNAMES, and STOREFRONT_INTERNAL_AUTH_TOKEN."
      )
    );
  }

  if (!result.accepted || !result.stats) {
    redirect(buildOrdersFlashRedirect(returnTo, "error", "Payment recovery request failed. Check server logs."));
  }

  const stats = result.stats;
  const message = `Payment recovery checked ${stats.trackedClaimed} claimed payments, completed ${stats.trackedCompleted}, rescheduled ${stats.trackedRescheduled}, soft-cancelled ${stats.trackedCancelled}, errors ${stats.errors.length}.`;
  redirect(buildOrdersFlashRedirect(returnTo, stats.errors.length > 0 ? "error" : "success", message));
}
