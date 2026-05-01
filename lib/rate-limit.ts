import "server-only";

import crypto from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type EnforceRateLimitOptions = {
  bucketSuffix?: string | null;
};

function hasKnownProxyMarker(request: Request) {
  return Boolean(request.headers.get("cf-ray") || request.headers.get("fly-region") || request.headers.get("x-vercel-id"));
}

function getClientIp(request: Request): string {
  for (const header of ["cf-connecting-ip", "fly-client-ip"]) {
    const value = request.headers.get(header);
    if (value) {
      return value.trim();
    }
  }

  const allowGenericForwardingHeaders = process.env.NODE_ENV !== "production" || hasKnownProxyMarker(request);
  if (allowGenericForwardingHeaders) {
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) {
      return realIp;
    }

    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) {
      return forwardedFor.split(",")[0]?.trim() || "unknown";
    }
  }

  return "unknown";
}

function buildRateLimitKey(request: Request, key: string, options?: EnforceRateLimitOptions) {
  const clientIp = getClientIp(request);
  const userAgent = request.headers.get("user-agent")?.trim() || "unknown";
  const fingerprint = crypto.createHash("sha256").update(`${clientIp}|${userAgent}`).digest("hex");
  const normalizedBucketSuffix = options?.bucketSuffix?.trim();

  if (!normalizedBucketSuffix) {
    return `${key}:${fingerprint}`;
  }

  const suffixFingerprint = crypto.createHash("sha256").update(`${fingerprint}|${normalizedBucketSuffix}`).digest("hex");
  return `${key}:${suffixFingerprint}`;
}

export async function enforceRateLimit(
  request: Request,
  key: string,
  limit: number,
  windowMs: number,
  options?: EnforceRateLimitOptions
): Promise<RateLimitResult> {
  const bucketKey = buildRateLimitKey(request, key, options);
  const { data, error } = await createAdminSupabaseClient().rpc("consume_rate_limit", {
    rate_key: bucketKey,
    max_requests: limit,
    window_seconds: Math.ceil(windowMs / 1000)
  });

  if (error) {
    throw new Error(`Rate limit check failed: ${error.message}`);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object") {
    throw new Error("Rate limit check returned no result.");
  }

  return {
    allowed: Boolean(result.allowed),
    remaining: Number(result.remaining ?? 0),
    retryAfterSeconds: Number(result.retry_after_seconds ?? 1)
  };
}
