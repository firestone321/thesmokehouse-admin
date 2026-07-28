import { after, NextResponse } from "next/server";
import {
  processAdminPushDispatchQueue,
  reopenNoSubscriberAdminPushDispatches,
  runAdminPushDrainWithLock
} from "@/lib/push/admin-paid-order-notifications";
import { AdminAuthorizationError, assertSameOriginRequest, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { RequestBodyTooLargeError } from "@/lib/request-limits";
import { enforceRateLimit } from "@/lib/rate-limit";
import { adminPushSubscriptionSchema } from "@/lib/schemas/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { RequestValidationError, parseJsonBody } from "@/lib/validation/http";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const actor = await requireApprovedAdminRole();

    const routeRateLimit = await enforceRateLimit(request, "admin-push-subscribe", 12, 60_000);
    if (!routeRateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many requests. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(routeRateLimit.retryAfterSeconds) } }
      );
    }

    const body = await parseJsonBody(request, adminPushSubscriptionSchema, { maxBytes: 16 * 1024 });
    const endpointRateLimit = await enforceRateLimit(request, "admin-push-subscribe-endpoint", 6, 60_000, {
      bucketSuffix: body.endpoint
    });
    if (!endpointRateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many requests. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(endpointRateLimit.retryAfterSeconds) } }
      );
    }

    const timestamp = new Date().toISOString();
    const supabaseAdmin = createAdminSupabaseClient();
    const { data, error } = await supabaseAdmin
      .from("admin_push_subscriptions")
      .upsert(
        {
          owner_profile_id: actor.userId,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          last_seen_at: timestamp,
          updated_at: timestamp
        },
        {
          onConflict: "endpoint"
        }
      )
      .select("id,endpoint,last_seen_at")
      .single();

    if (error) {
      throw new Error(`Unable to save admin push subscription: ${error.message}`);
    }

    after(async () => {
      try {
        await runAdminPushDrainWithLock(async () => {
          await reopenNoSubscriberAdminPushDispatches(10);
          await processAdminPushDispatchQueue({ limit: 5 });
        });
      } catch (queueError) {
        console.error("admin_push_dispatch_after_subscription_failed", queueError);
      }
    });

    return NextResponse.json({
      ok: true,
      subscriptionId: data.id,
      endpoint: data.endpoint,
      lastSeenAt: data.last_seen_at
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ message: "Push subscription payload is too large." }, { status: 413 });
    }

    if (error instanceof RequestValidationError) {
      return NextResponse.json({ message: error.message, issues: error.issues }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to save admin push subscription.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
