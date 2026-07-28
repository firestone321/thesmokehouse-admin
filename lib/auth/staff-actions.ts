"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canProvisionStaffAccounts, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createStaffUserActionSchema, manageStaffAccountActionSchema } from "@/lib/schemas/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { RequestValidationError } from "@/lib/validation/http";
import { parseFormData } from "@/lib/validation/form-data";

const STAFF_ACCOUNT_BAN_DURATION = "876000h";

function buildStaffRedirect(status: "success" | "error", message: string) {
  const params = new URLSearchParams({ status, message });
  return `/staff?${params.toString()}`;
}

function isAuthUserDisabled(bannedUntil?: string) {
  if (!bannedUntil) {
    return false;
  }

  const bannedUntilTime = Date.parse(bannedUntil);
  return Number.isFinite(bannedUntilTime) && bannedUntilTime > Date.now();
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

export async function manageStaffAccountAction(formData: FormData) {
  const actor = await requireApprovedAdminRole();

  if (!canProvisionStaffAccounts(actor.role)) {
    redirect(buildStaffRedirect("error", "Only managers and administrators can manage staff accounts."));
  }

  let input;
  try {
    input = parseFormData(formData, manageStaffAccountActionSchema);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      redirect(buildStaffRedirect("error", error.issues[0]?.message ?? "Invalid staff account action."));
    }

    throw error;
  }

  if (input.user_id === actor.userId) {
    redirect(buildStaffRedirect("error", "You cannot disable or change the role of your own signed-in account."));
  }

  const supabase = createAdminSupabaseClient();
  const { data: targetProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,role")
    .eq("id", input.user_id)
    .maybeSingle();

  if (profileError) {
    redirect(buildStaffRedirect("error", `Unable to load the selected staff profile: ${profileError.message}`));
  }

  if (!targetProfile || !["staff", "manager", "admin"].includes(targetProfile.role)) {
    redirect(buildStaffRedirect("error", "The selected account is not an approved dashboard profile."));
  }

  const actorCanManageTarget = actor.role === "admin"
    ? targetProfile.role !== "admin"
    : targetProfile.role === "staff";

  if (!actorCanManageTarget) {
    redirect(
      buildStaffRedirect(
        "error",
        actor.role === "admin"
          ? "Administrator accounts cannot be changed from this page."
          : "Managers can manage staff accounts, but manager and administrator accounts require an administrator."
      )
    );
  }

  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(input.user_id);
  if (authUserError || !authUserData.user) {
    redirect(
      buildStaffRedirect(
        "error",
        `Unable to load the selected Supabase Auth account: ${authUserError?.message ?? "User not found."}`
      )
    );
  }

  const email = targetProfile.email ?? authUserData.user.email ?? "The selected account";

  if (input.operation === "disable" || input.operation === "enable") {
    const shouldDisable = input.operation === "disable";
    const { data: updatedAuthUserData, error: updateError } = await supabase.auth.admin.updateUserById(input.user_id, {
      ban_duration: shouldDisable ? STAFF_ACCOUNT_BAN_DURATION : "none"
    });

    if (updateError || !updatedAuthUserData.user) {
      redirect(
        buildStaffRedirect(
          "error",
          `Unable to ${shouldDisable ? "disable" : "re-enable"} ${email}: ${
            updateError?.message ?? "Supabase did not return the updated Auth user."
          }`
        )
      );
    }

    const disabledAfterUpdate = isAuthUserDisabled(updatedAuthUserData.user.banned_until);
    if (disabledAfterUpdate !== shouldDisable) {
      redirect(
        buildStaffRedirect(
          "error",
          `Supabase did not confirm that ${email} was ${shouldDisable ? "disabled" : "re-enabled"}.`
        )
      );
    }

    revalidatePath("/staff");
    redirect(
      buildStaffRedirect(
        "success",
        `${email} was ${shouldDisable ? "disabled" : "re-enabled"}.`
      )
    );
  }

  if (targetProfile.role !== "staff") {
    redirect(buildStaffRedirect("error", "Only staff accounts can be promoted to manager."));
  }

  const { error: roleUpdateError } = await supabase
    .from("profiles")
    .update({ role: "manager" })
    .eq("id", input.user_id)
    .eq("role", "staff");

  if (roleUpdateError) {
    redirect(buildStaffRedirect("error", `Unable to promote ${email}: ${roleUpdateError.message}`));
  }

  const previousAppMetadata = authUserData.user.app_metadata ?? {};
  const roleChangedAt = new Date().toISOString();
  const { data: promotedAuthUserData, error: authUpdateError } = await supabase.auth.admin.updateUserById(input.user_id, {
    app_metadata: {
      ...previousAppMetadata,
      provisioned_by_admin: true,
      role: "manager",
      role_changed_by_admin_user_id: actor.userId,
      role_changed_at: roleChangedAt
    }
  });

  if (authUpdateError || !promotedAuthUserData.user) {
    const { error: rollbackError } = await supabase
      .from("profiles")
      .update({ role: "staff" })
      .eq("id", input.user_id)
      .eq("role", "manager");

    if (rollbackError) {
      console.error("staff_role_promotion_rollback_failed", {
        userId: input.user_id,
        error: rollbackError.message
      });
    }

    redirect(
      buildStaffRedirect(
        "error",
        rollbackError
          ? `Promotion failed and the profile could not be rolled back. Review ${email} in Supabase.`
          : `Promotion failed and ${email} was restored to Staff: ${
              authUpdateError?.message ?? "Supabase did not return the updated Auth user."
            }`
      )
    );
  }

  const { data: promotedProfile, error: readbackError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", input.user_id)
    .maybeSingle();

  if (
    readbackError ||
    promotedProfile?.role !== "manager" ||
    promotedAuthUserData.user.app_metadata?.role !== "manager"
  ) {
    redirect(
      buildStaffRedirect(
        "error",
        `Promotion was submitted but could not be verified for ${email}. Review the account in Supabase.`
      )
    );
  }

  revalidatePath("/staff");
  redirect(buildStaffRedirect("success", `${email} was promoted to Manager.`));
}
