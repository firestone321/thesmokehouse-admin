"use server";

import { redirect } from "next/navigation";
import { buildLoginRedirect, getBaseUrl } from "@/lib/auth/utils";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function requiredEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    throw new Error("Email is required.");
  }

  return email;
}

export async function sendMagicLinkAction(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const email = requiredEmail(formData);
  const nextPath = String(formData.get("next") ?? "/dashboard").trim() || "/dashboard";
  const baseUrl = await getBaseUrl();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${baseUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`
    }
  });

  if (error) {
    redirect(buildLoginRedirect(nextPath, `Unable to send magic link: ${error.message}`));
  }

  redirect(buildLoginRedirect(nextPath, `Magic link sent to ${email}.`));
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login?message=Signed out.");
}
