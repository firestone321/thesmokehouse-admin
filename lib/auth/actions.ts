"use server";

import { redirect } from "next/navigation";
import { buildLoginRedirect } from "@/lib/auth/utils";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function requiredEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    throw new Error("Email is required.");
  }

  return email;
}

function requiredPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");

  if (!password) {
    throw new Error("Password is required.");
  }

  return password;
}

export async function signInWithPasswordAction(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const email = requiredEmail(formData);
  const password = requiredPassword(formData);
  const nextPath = String(formData.get("next") ?? "/dashboard").trim() || "/dashboard";

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    redirect(buildLoginRedirect(nextPath, `Unable to sign in: ${error.message}`));
  }

  redirect(nextPath);
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login?message=Signed out.");
}
