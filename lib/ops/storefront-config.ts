import "server-only";

const EXPECTED_STOREFRONT_HOSTNAMES_ENV = "EXPECTED_STOREFRONT_HOSTNAMES";
const STOREFRONT_BASE_URL_ENV = "STOREFRONT_BASE_URL";
const STOREFRONT_INTERNAL_AUTH_TOKEN_ENV = "STOREFRONT_INTERNAL_AUTH_TOKEN";

export type StorefrontInternalRequestConfigurationStatus = {
  configured: boolean;
  missingEnvironmentVariables: string[];
  configurationError: string | null;
};

function readEnv(name: string) {
  return process.env[name]?.trim() || null;
}

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
  return readEnv(STOREFRONT_INTERNAL_AUTH_TOKEN_ENV);
}

export function getValidatedStorefrontBaseUrl() {
  const rawBaseUrl = readEnv(STOREFRONT_BASE_URL_ENV);
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

export function getStorefrontInternalRequestConfigurationStatus(): StorefrontInternalRequestConfigurationStatus {
  const missingEnvironmentVariables = [
    !readEnv(STOREFRONT_BASE_URL_ENV) ? STOREFRONT_BASE_URL_ENV : null,
    !readEnv(EXPECTED_STOREFRONT_HOSTNAMES_ENV) ? EXPECTED_STOREFRONT_HOSTNAMES_ENV : null,
    !getStorefrontSigningSecret() ? STOREFRONT_INTERNAL_AUTH_TOKEN_ENV : null
  ].filter((name): name is string => Boolean(name));

  if (missingEnvironmentVariables.length > 0) {
    return {
      configured: false,
      missingEnvironmentVariables,
      configurationError: null
    };
  }

  try {
    return {
      configured: Boolean(getValidatedStorefrontBaseUrl() && getStorefrontSigningSecret()),
      missingEnvironmentVariables: [],
      configurationError: null
    };
  } catch (error) {
    return {
      configured: false,
      missingEnvironmentVariables: [],
      configurationError: error instanceof Error ? error.message : "Storefront push configuration is invalid."
    };
  }
}

export function isStorefrontInternalRequestConfigured() {
  return getStorefrontInternalRequestConfigurationStatus().configured;
}
