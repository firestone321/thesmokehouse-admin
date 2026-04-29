import { NextResponse } from "next/server";
import { processAdminPushDispatchQueue } from "@/lib/push/admin-paid-order-notifications";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function requireAdminSession() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized.");
  }
}

export async function POST() {
  try {
    await requireAdminSession();
    const stats = await processAdminPushDispatchQueue({ limit: 5 });
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process admin push notifications.";
    const status = message === "Unauthorized." ? 401 : 500;
    return NextResponse.json({ message }, { status });
  }
}
