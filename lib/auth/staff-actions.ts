"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canProvisionStaffAccounts, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createStaffUserActionSchema } from "@/lib/schemas/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { RequestValidationError } from "@/lib/validation/http";
import { parseFormData } from "@/lib/validation/form-data";

function buildStaffRedirect(status: "success" | "error", message: string) {
  const params = new URLSearchParams({ status, message });
  return `/staff?${params.toString()}`;
}

function getCreateUserErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("already") && (normalized.includes("registered") || normalized.includes("exists"))) {
    return "An Auth account with that email already exists. Use the existing account instead of creating a duplicate.";
  }

  return `Unable to create staff account: ${message}`;
}

async function rollbackCreatedAuthUser(userId: string) {
  const { error } = await createAdminSupabaseClient().auth.admin.deleteUser(userId);

  if (error) {
    console.error("staff_account_provisioning_rollback_failed", {
      userId,
      error: error.message
    });
  }

  return error;
}

export async function createStaffUserAction(formData: FormData) {
  const actor = await requireApprovedAdminRole();

  if (!canProvisionStaffAccounts(actor.role)) {
    redirect(buildStaffRedirect("error", "Only managers and administrators can create staff accounts."));
  }

  let input;
  try {
    input = parseFormData(formData, createStaffUserActionSchema);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      redirect(
        buildStaffRedirect(
          "error",
          error.issues[0]?.message ?? "Check the staff email and password, then try again."
        )
      );
    }

    throw error;
  }

  const supabase = createAdminSupabaseClient();
  const provisionedAt = new Date().toISOString();
  const { data, error: createError } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: {
      provisioned_by_admin: true,
      provisioned_by_admin_user_id: actor.userId,
      provisioned_by_admin_at: provisionedAt,
      role: "staff"
    }
  });

  if (createError || !data.user) {
    redirect(
      buildStaffRedirect(
        "error",
        getCreateUserErrorMessage(createError?.message ?? "Supabase did not return the new Auth user.")
      )
    );
  }

  const userId = data.user.id;
  const normalizedEmail = data.user.email?.trim().toLowerCase() ?? input.email;
  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email: normalizedEmail,
      role: "staff"
    },
    {
      onConflict: "id"
    }
  );

  if (profileError) {
    const rollbackError = await rollbackCreatedAuthUser(userId);
    redirect(
      buildStaffRedirect(
        "error",
        rollbackError
          ? "Staff provisioning failed and the new Auth account could not be rolled back. Review it in Supabase."
          : `Staff provisioning failed and the new Auth account was rolled back: ${profileError.message}`
      )
    );
  }

  const { error: customerDeleteError } = await supabase.from("customers").delete().eq("id", userId);
  if (customerDeleteError) {
    const rollbackError = await rollbackCreatedAuthUser(userId);
    redirect(
      buildStaffRedirect(
        "error",
        rollbackError
          ? "The account could not be classified cleanly or rolled back. Review it in Supabase."
          : "The account could not be classified cleanly, so the new Auth account was rolled back."
      )
    );
  }

  const { data: profile, error: readbackError } = await supabase
    .from("profiles")
    .select("id,email,role")
    .eq("id", userId)
    .maybeSingle();

  if (readbackError || !profile || profile.role !== "staff" || profile.email.toLowerCase() !== normalizedEmail) {
    const rollbackError = await rollbackCreatedAuthUser(userId);
    redirect(
      buildStaffRedirect(
        "error",
        rollbackError
          ? "Staff profile verification failed and rollback was unsuccessful. Review the account in Supabase."
          : "Staff profile verification failed, so the new Auth account was rolled back."
      )
    );
  }

  revalidatePath("/staff");
  redirect(buildStaffRedirect("success", `${normalizedEmail} was created as a staff account.`));
}
