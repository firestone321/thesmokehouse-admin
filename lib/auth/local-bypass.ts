import "server-only";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const enabledValues = new Set(["1", "true", "yes", "on"]);

function parseHostname(host: string | null | undefined) {
  if (!host) {
    return null;
  }

  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return host.toLowerCase();
  }
}

export function isLocalAuthBypassEnabledForHost(host: string | null | undefined) {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const envValue = process.env.LOCAL_AUTH_BYPASS?.trim().toLowerCase();

  if (!envValue || !enabledValues.has(envValue)) {
    return false;
  }

  const hostname = parseHostname(host);

  return hostname ? localHostnames.has(hostname) : false;
}

export function isLocalAuthBypassEnabledForRequest(request: NextRequest) {
  return isLocalAuthBypassEnabledForHost(request.headers.get("host") ?? request.nextUrl.host);
}

export async function isLocalAuthBypassEnabled() {
  const headerStore = await headers();

  return isLocalAuthBypassEnabledForHost(headerStore.get("host"));
}
