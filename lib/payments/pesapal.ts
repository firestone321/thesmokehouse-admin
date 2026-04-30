import "server-only";

type PesapalTokenResponse = {
  token?: string;
  error?: {
    message?: string | null;
  } | null;
  message?: string | null;
};

type PesapalTransactionStatusResponse = {
  payment_status_description?: string | null;
  confirmation_code?: string | null;
  order_tracking_id?: string | null;
};

type TokenCache = {
  token: string;
  expiresAt: number;
};

export type NormalizedPesapalPaymentState = "pending" | "paid" | "failed";

const PESAPAL_REQUEST_TIMEOUT_MS = 10_000;
let tokenCache: TokenCache | null = null;

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getBaseUrl() {
  return process.env.PESAPAL_BASE_URL?.trim() || "https://cybqa.pesapal.com/pesapalv3";
}

function normalizePesapalPaymentState(rawStatus: string | null | undefined): NormalizedPesapalPaymentState {
  const status = rawStatus?.trim().toUpperCase();

  if (status === "COMPLETED") {
    return "paid";
  }

  if (status === "FAILED" || status === "REVERSED") {
    return "failed";
  }

  return "pending";
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PESAPAL_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function pesapalRequest<T>(path: string, init: RequestInit, options?: { authenticated?: boolean }) {
  const url = `${getBaseUrl()}${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");

  if (options?.authenticated) {
    headers.set("Authorization", `Bearer ${await getPesapalAuthToken()}`);
  }

  const response = await fetchWithTimeout(url, {
    ...init,
    headers
  });

  const rawText = await response.text();
  const payload = rawText.length > 0 ? (JSON.parse(rawText) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(`Pesapal request failed (${response.status}): ${rawText || response.statusText}`);
  }

  return payload;
}

async function getPesapalAuthToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 15_000) {
    return tokenCache.token;
  }

  const response = await pesapalRequest<PesapalTokenResponse>("/api/Auth/RequestToken", {
    method: "POST",
    body: JSON.stringify({
      consumer_key: getRequiredEnv("PESAPAL_CONSUMER_KEY"),
      consumer_secret: getRequiredEnv("PESAPAL_CONSUMER_SECRET")
    })
  });

  if (!response.token) {
    throw new Error(response.error?.message ?? response.message ?? "Pesapal token request failed.");
  }

  tokenCache = {
    token: response.token,
    expiresAt: Date.now() + 4 * 60_000
  };

  return response.token;
}

export async function getPesapalTransactionStatus(orderTrackingId: string) {
  const url = new URL(`${getBaseUrl()}/api/Transactions/GetTransactionStatus`);
  url.searchParams.set("orderTrackingId", orderTrackingId);

  const response = await fetchWithTimeout(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${await getPesapalAuthToken()}`
    }
  });

  const rawText = await response.text();
  const payload = rawText.length > 0 ? (JSON.parse(rawText) as PesapalTransactionStatusResponse) : {};

  if (!response.ok) {
    throw new Error(`Pesapal status request failed (${response.status}): ${rawText || response.statusText}`);
  }

  return {
    providerReference: orderTrackingId,
    paymentStatus: normalizePesapalPaymentState(payload.payment_status_description),
    providerStatus: payload.payment_status_description ?? null,
    paymentReference: payload.confirmation_code ?? null,
    rawResponse: payload
  };
}
