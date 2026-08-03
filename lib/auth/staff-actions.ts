"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canProvisionStaffAccounts, requireApprovedAdminRole } from "@/lib/auth/admin-role";
import { createStaffUserActionSchema, manageStaffAccountActionSchema } from "@/lib/schemas/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { recordStaffActivity } from "@/lib/activity/log";
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
  const roleLabel = input.role === "chef" ? "Chef" : "Staff";
  const provisionedAt = new Date().toISOString();
  const { data, error: createError } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: {
      provisioned_by_admin: true,
      provisioned_by_admin_user_id: actor.userId,
      provisioned_by_admin_at: provisionedAt,
      role: input.role
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
      role: input.role
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

  if (readbackError || !profile || profile.role !== input.role || profile.email.toLowerCase() !== normalizedEmail) {
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

  await recordStaffActivity({
    actor,
    action: "staff.account_created",
    entityType: "staff_profile",
    entityId: userId,
    summary: (actor.email ?? "An administrator") + " created staff account " + normalizedEmail + ".",
    metadata: { target_email: normalizedEmail, target_role: input.role }
  });

  revalidatePath("/staff");
  redirect(buildStaffRedirect("success", `${normalizedEmail} was created with the ${roleLabel} role.`));
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

  if (!targetProfile || !["staff", "chef", "manager", "admin"].includes(targetProfile.role)) {
    redirect(buildStaffRedirect("error", "The selected account is not an approved dashboard profile."));
  }

  const actorCanManageTarget = actor.role === "admin"
    ? targetProfile.role !== "admin"
    : targetProfile.role === "staff" || targetProfile.role === "chef";

  if (!actorCanManageTarget) {
    redirect(
      buildStaffRedirect(
        "error",
        actor.role === "admin"
          ? "Administrator accounts cannot be changed from this page."
          : "Managers can manage Staff and Chef accounts, but Manager and Administrator accounts require an administrator."
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

    await recordStaffActivity({
      actor,
      action: shouldDisable ? "staff.account_disabled" : "staff.account_enabled",
      entityType: "staff_profile",
      entityId: input.user_id,
      summary: (actor.email ?? "An administrator") + (shouldDisable ? " disabled " : " enabled ") + email + ".",
      metadata: { target_email: email, target_role: targetProfile.role }
    });

    revalidatePath("/staff");
    redirect(
      buildStaffRedirect(
        "success",
        `${email} was ${shouldDisable ? "disabled" : "re-enabled"}.`
      )
    );
  }

  const targetRole = input.target_role;
  if (!targetRole) {
    redirect(buildStaffRedirect("error", "Choose the new role."));
  }

  if (targetProfile.role === targetRole) {
    redirect(buildStaffRedirect("error", `${email} already has the ${targetRole} role.`));
  }

  const { error: roleUpdateError } = await supabase
    .from("profiles")
    .update({ role: targetRole })
    .eq("id", input.user_id)
    .eq("role", targetProfile.role);

  if (roleUpdateError) {
    redirect(buildStaffRedirect("error", `Unable to change ${email}'s role: ${roleUpdateError.message}`));
  }

  const previousAppMetadata = authUserData.user.app_metadata ?? {};
  const roleChangedAt = new Date().toISOString();
  const { data: promotedAuthUserData, error: authUpdateError } = await supabase.auth.admin.updateUserById(input.user_id, {
    app_metadata: {
      ...previousAppMetadata,
      provisioned_by_admin: true,
      role: targetRole,
      role_changed_by_admin_user_id: actor.userId,
      role_changed_at: roleChangedAt
    }
  });

  if (authUpdateError || !promotedAuthUserData.user) {
    const { error: rollbackError } = await supabase
      .from("profiles")
      .update({ role: targetProfile.role })
      .eq("id", input.user_id)
      .eq("role", targetRole);

    if (rollbackError) {
      console.error("staff_role_change_rollback_failed", {
        userId: input.user_id,
        error: rollbackError.message
      });
    }

    redirect(
      buildStaffRedirect(
        "error",
        rollbackError
          ? `Role change failed and the profile could not be rolled back. Review ${email} in Supabase.`
          : `Role change failed and ${email} was restored to ${targetProfile.role}: ${
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
    promotedProfile?.role !== targetRole ||
    promotedAuthUserData.user.app_metadata?.role !== targetRole
  ) {
    redirect(
      buildStaffRedirect(
        "error",
        `The role change was submitted but could not be verified for ${email}. Review the account in Supabase.`
      )
    );
  }

  await recordStaffActivity({
    actor,
    action: "staff.role_changed",
    entityType: "staff_profile",
    entityId: input.user_id,
    summary: (actor.email ?? "An administrator") + " changed " + email + " to " + targetRole + ".",
    metadata: { target_email: email, previous_role: targetProfile.role, target_role: targetRole }
  });

  revalidatePath("/staff");
  redirect(buildStaffRedirect("success", `${email} now has the ${targetRole === "chef" ? "Chef" : formatRoleLabel(targetRole)} role.`));
}

function formatRoleLabel(role: "staff" | "manager") {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
