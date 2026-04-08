import { headers } from "next/headers";

export async function getBaseUrl() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");

  if (!host) {
    throw new Error("Unable to determine request host for auth redirect.");
  }

  return `${protocol}://${host}`;
}

export function buildLoginRedirect(nextPath?: string | null, message?: string | null) {
  const params = new URLSearchParams();

  if (nextPath) {
    params.set("next", nextPath);
  }

  if (message) {
    params.set("message", message);
  }

  const query = params.toString();
  return query.length > 0 ? `/login?${query}` : "/login";
}
