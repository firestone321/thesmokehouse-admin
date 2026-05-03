import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { getPesapalTransactionStatus } from "@/lib/payments/pesapal";
import { reverifyOrderPaymentActionSchema } from "@/lib/schemas/admin";
import { parseFormData } from "@/lib/validation/form-data";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

const pendingPaymentSoftCancelMs = 7 * 60_000;

function revalidateOperationalPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/procurement");
  revalidatePath("/suppliers");
  revalidatePath("/inventory");
  revalidatePath("/menu");
  revalidatePath("/orders");
}

export async function reverifyOrderPaymentAction(formData: FormData) {
  await requireApprovedAdminRole();
  const input = parseFormData(formData, reverifyOrderPaymentActionSchema);
  const supabase = createAdminSupabaseClient();
  const orderId = input.order_id;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,status,payment_status,created_at,order_tracking_id,payment_redirect_url")
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

  const status = await getPesapalTransactionStatus(order.order_tracking_id);

  if (status.paymentStatus === "paid") {
    const { error } = await supabase.rpc("mark_order_as_paid", {
      p_order_id: orderId,
      p_payment_provider: "pesapal",
      p_order_tracking_id: order.order_tracking_id,
      p_payment_reference: status.paymentReference,
      p_payment_redirect_url: order.payment_redirect_url,
      p_note: "Payment manually reverified by staff through the admin dashboard."
    });

    if (error) {
      throw new Error(`Unable to mark order as paid after manual reverify: ${error.message}`);
    }

    revalidateOperationalPaths();
    redirect(`/orders/${orderId}?payment_reverified=paid`);
  }

  const orderAgeMs = Date.now() - Date.parse(order.created_at);
  const shouldSoftCancel =
    order.payment_status !== "cancelled" &&
    order.status === "new" &&
    Number.isFinite(orderAgeMs) &&
    orderAgeMs >= pendingPaymentSoftCancelMs;
  const nextPaymentStatus = order.payment_status === "cancelled" || shouldSoftCancel ? "cancelled" : status.paymentStatus;
  const nextOrderStatus = shouldSoftCancel ? "cancelled" : order.status;
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: nextOrderStatus,
      payment_status: nextPaymentStatus,
      payment_provider: "pesapal",
      payment_reference: status.paymentReference,
      payment_last_verified_at: now,
      payment_initiation_failure_code:
        status.paymentStatus === "failed" ? "manual_reverify_failed" : shouldSoftCancel ? "manual_reverify_soft_cancelled" : null,
      payment_initiation_failure_message:
        status.paymentStatus === "failed"
          ? "Manual Pesapal reverify returned a failed or reversed payment state."
          : shouldSoftCancel
            ? "Manual Pesapal reverify found this tracked payment still non-paid after the pending window."
          : null,
      payment_initiation_failed_at: status.paymentStatus === "failed" || shouldSoftCancel ? now : null
    })
    .eq("id", orderId);

  if (updateError) {
    throw new Error(`Unable to persist manual payment reverify: ${updateError.message}`);
  }

  revalidateOperationalPaths();
  redirect(`/orders/${orderId}?payment_reverified=${encodeURIComponent(nextPaymentStatus)}`);
}
