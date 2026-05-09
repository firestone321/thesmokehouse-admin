import "server-only";

const EXPECTED_STOREFRONT_HOSTNAMES_ENV = "EXPECTED_STOREFRONT_HOSTNAMES";

function getExpectedStorefrontHostnames() {
  return new Set(
    (process.env[EXPECTED_STOREFRONT_HOSTNAMES_ENV] ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function getStorefrontSigningSecret() {
  return process.env.STOREFRONT_INTERNAL_AUTH_TOKEN?.trim() || null;
}

export function getValidatedStorefrontBaseUrl() {
  const rawBaseUrl = process.env.STOREFRONT_BASE_URL?.trim();
  if (!rawBaseUrl) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error("STOREFRONT_BASE_URL must be a valid absolute URL.");
  }

  const hostname = url.hostname.toLowerCase();
  const expectedHostnames = getExpectedStorefrontHostnames();

  if (expectedHostnames.size === 0) {
    throw new Error(`Missing required environment variable: ${EXPECTED_STOREFRONT_HOSTNAMES_ENV}`);
  }

  if (!expectedHostnames.has(hostname)) {
    throw new Error("STOREFRONT_BASE_URL hostname is not allowed.");
  }

  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && isLocalhost(hostname))) {
    throw new Error("STOREFRONT_BASE_URL must use HTTPS.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/+$/, "");
}

export function isStorefrontInternalRequestConfigured() {
  try {
    return Boolean(getValidatedStorefrontBaseUrl() && getStorefrontSigningSecret());
  } catch {
    return false;
  }
}
