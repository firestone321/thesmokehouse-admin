import "server-only";

import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { isLocalAuthBypassEnabled } from "@/lib/auth/local-bypass";

export type AdminRole = "admin" | "manager" | "chef" | "staff" | "cashier";

const approvedAdminRoles = new Set<AdminRole>(["admin", "manager", "chef", "staff"]);
const dashboardRoles = new Set<AdminRole>(["admin", "manager", "chef", "staff", "cashier"]);
const staffProvisioningRoles = new Set<AdminRole>(["admin", "manager"]);
const approvalRoles = new Set<AdminRole>(["admin", "manager"]);
const posRoles = new Set<AdminRole>(["admin", "manager", "cashier"]);
const posViewRoles = new Set<AdminRole>(["admin", "manager", "cashier", "staff"]);

export class AdminAuthorizationError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AdminAuthorizationError";
    this.status = status;
  }
}

export function canProvisionStaffAccounts(role: AdminRole) {
  return staffProvisioningRoles.has(role);
}

export function canApproveOperationalChanges(role: AdminRole) {
  return approvalRoles.has(role);
}

export function isRegularStaffRole(role: AdminRole) {
  return role === "staff" || role === "chef";
}

async function requireRoleFromSet(allowedRoles: Set<AdminRole>): Promise<{ userId: string; email: string | null; role: AdminRole }> {
  if (await isLocalAuthBypassEnabled()) {
    return {
      userId: "local-auth-bypass",
      email: "Localhost auth bypass",
      role: "admin"
    };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new AdminAuthorizationError("Unauthorized.", 401);
  }

  const { data: profile, error: profileError } = await createAdminSupabaseClient()
    .from("profiles")
    .select("role,email")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Unable to verify admin role: ${profileError.message}`);
  }

  const role = typeof profile?.role === "string" ? profile.role : null;
  if (!role || !allowedRoles.has(role as AdminRole)) {
    throw new AdminAuthorizationError("This account is not approved for the requested Smokehouse admin area.", 403);
  }

  return {
    userId: user.id,
    email: typeof profile?.email === "string" ? profile.email : user.email ?? null,
    role: role as AdminRole
  };
}

export async function requireApprovedAdminRole(): Promise<{ userId: string; email: string | null; role: AdminRole }> {
  return requireRoleFromSet(approvedAdminRoles);
}

export async function requireDashboardRole(): Promise<{ userId: string; email: string | null; role: AdminRole }> {
  return requireRoleFromSet(dashboardRoles);
}

export async function requirePosAccess(): Promise<{ userId: string; email: string | null; role: AdminRole }> {
  return requireRoleFromSet(posRoles);
}

export async function requirePosViewAccess(): Promise<{ userId: string; email: string | null; role: AdminRole }> {
  return requireRoleFromSet(posViewRoles);
}

const ALLOWED_REQUEST_ORIGINS = new Set<string>(
  (process.env.ADMIN_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

export function assertSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  let candidate = origin;

  if (!candidate && referer) {
    try {
      candidate = new URL(referer).origin;
    } catch {
      throw new AdminAuthorizationError("Invalid request origin.", 403);
    }
  }

  if (!candidate) {
    throw new AdminAuthorizationError("Missing request origin.", 403);
  }

  if (ALLOWED_REQUEST_ORIGINS.size === 0) {
    const host = request.headers.get("host");
    if (!host) {
      throw new AdminAuthorizationError("Missing request host.", 403);
    }

    const expected = `https://${host}`;
    const expectedHttp = `http://${host}`;
    if (candidate !== expected && candidate !== expectedHttp) {
      throw new AdminAuthorizationError("Cross-origin request rejected.", 403);
    }

    return;
  }

  if (!ALLOWED_REQUEST_ORIGINS.has(candidate)) {
    throw new AdminAuthorizationError("Cross-origin request rejected.", 403);
  }
}
