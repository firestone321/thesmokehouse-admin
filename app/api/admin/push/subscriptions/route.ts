import { NextResponse } from "next/server";
import { processAdminPushDispatchQueue } from "@/lib/push/admin-paid-order-notifications";
import { AdminAuthorizationError, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

type AdminPushSubscriptionInput = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
};

function readString(value: unknown, name: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new Error(`${name} is required.`);
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error(`${name} is invalid.`);
  }

  return trimmed;
}

function parseSubscriptionInput(input: AdminPushSubscriptionInput) {
  const endpoint = readString(input.endpoint, "endpoint", 2_000);

  try {
    new URL(endpoint);
  } catch {
    throw new Error("endpoint is invalid.");
  }

  return {
    endpoint,
    p256dh: readString(input.keys?.p256dh, "p256dh", 1_000),
    auth: readString(input.keys?.auth, "auth", 1_000)
  };
}

export async function POST(request: Request) {
  try {
    await requireApprovedAdminRole();

    const body = (await request.json().catch(() => null)) as AdminPushSubscriptionInput | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Invalid push subscription payload." }, { status: 400 });
    }

    const input = parseSubscriptionInput(body);
    const timestamp = new Date().toISOString();
    const supabaseAdmin = createAdminSupabaseClient();
    const { data, error } = await supabaseAdmin
      .from("admin_push_subscriptions")
      .upsert(
        {
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
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

    void processAdminPushDispatchQueue({ limit: 2 }).catch((queueError) => {
      console.error("admin_push_dispatch_after_subscription_failed", queueError);
    });

    return NextResponse.json({
      ok: true,
      subscriptionId: data.id,
      endpoint: data.endpoint,
      lastSeenAt: data.last_seen_at
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save admin push subscription.";
    const status = error instanceof AdminAuthorizationError ? error.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
