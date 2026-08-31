import { NextResponse } from "next/server";
import { AdminAuthorizationError, requirePosAccess } from "@/lib/auth/admin-role";
import {
  issueOnlineReceiptPrintInstructions,
  type CanonicalPosReceipt
} from "@/lib/pos/hardware-bridge";
import { onlineReceiptPrintJobRouteParamsSchema } from "@/lib/schemas/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { RequestValidationError, parseObject } from "@/lib/validation/http";

type RouteContext = {
  params: Promise<{ printJobId: string }>;
};

function parseCanonicalReceipt(value: unknown): CanonicalPosReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  if (
    typeof receipt.saleId !== "string"
    || typeof receipt.date !== "string"
    || !Array.isArray(receipt.items)
    || receipt.items.length === 0
    || typeof receipt.subtotal !== "number"
    || typeof receipt.total !== "number"
    || !["cash", "mobile_money", "card", "other"].includes(String(receipt.paymentMethod))
  ) {
    return null;
  }

  const items = receipt.items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.name !== "string"
      || typeof candidate.quantity !== "number"
      || typeof candidate.unitPrice !== "number"
      || typeof candidate.total !== "number"
    ) {
      return null;
    }
    return {
      name: candidate.name,
      quantity: candidate.quantity,
      unitPrice: candidate.unitPrice,
      total: candidate.total
    };
  });
  if (items.some((item) => item === null)) return null;

  return {
    saleId: receipt.saleId,
    date: receipt.date,
    items: items as CanonicalPosReceipt["items"],
    subtotal: receipt.subtotal,
    total: receipt.total,
    paymentMethod: receipt.paymentMethod as CanonicalPosReceipt["paymentMethod"]
  };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requirePosAccess();
    const { printJobId } = parseObject(await context.params, onlineReceiptPrintJobRouteParamsSchema);
    const { data, error } = await createAdminSupabaseClient()
      .from("online_receipt_print_jobs")
      .select("id,order_id,receipt,status,completed_at")
      .eq("id", printJobId)
      .maybeSingle();

    if (error) throw new Error(`Unable to load online receipt print job: ${error.message}`);
    if (!data) return NextResponse.json({ ok: false, message: "Receipt print job not found." }, { status: 404 });
    if (data.status === "accepted") {
      return NextResponse.json({ ok: true, data: { completed: true, completedAt: data.completed_at } });
    }

    const receipt = parseCanonicalReceipt(data.receipt);
    if (!receipt) {
      return NextResponse.json({ ok: false, message: "Receipt print job contains invalid receipt data." }, { status: 409 });
    }

    // Record the dispatch attempt before contacting the local bridge. The
    // bridge result is a second, completion/acceptance acknowledgement; it
    // must not be the first place an attempt becomes visible in the backlog.
    const { error: attemptError } = await createAdminSupabaseClient()
      .from("online_receipt_print_jobs")
      .update({ last_attempt_at: new Date().toISOString() })
      .eq("id", printJobId)
      .eq("status", "pending");
    if (attemptError) throw new Error(`Unable to record receipt print attempt: ${attemptError.message}`);

    const hardware = await issueOnlineReceiptPrintInstructions({
      printJobId: data.id,
      orderId: Number(data.order_id),
      receipt
    });
    if (!hardware) {
      return NextResponse.json({ ok: false, message: "Receipt printer authorization is not enabled." }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        completed: false,
        printJobId: data.id,
        orderId: Number(data.order_id),
        receipt,
        bridgeUrl: hardware.bridgeUrl,
        printAuthorization: hardware.printAuthorization,
        receiptFingerprint: hardware.receiptFingerprint
      }
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ ok: false, message: error.message, issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to load receipt print job.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
