import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

const CLOCK_SKEW_SECONDS = 30;
const DEFAULT_EXPIRY_SECONDS = 60;

type InternalTokenHeader = {
  alg: "HS256";
  typ: "internal-request";
};

type SignInternalRequestTokenInput = {
  secret: string;
  issuer: string;
  audience: string;
  purpose: string;
  method: string;
  path: string;
  expiresInSeconds?: number;
  idempotencyKey?: string;
  orderId?: string;
};

type InternalRequestTokenClaims = {
  iss: string;
  aud: string;
  purpose: string;
  method: string;
  path: string;
  iat: number;
  exp: number;
  jti: string;
  idempotencyKey?: string;
  orderId?: string;
};

type VerifyInternalRequestTokenInput = {
  token: string;
  secret: string;
  issuer: string;
  audience: string;
  purpose: string;
  method: string;
  path: string;
  idempotencyKey?: string;
  orderId?: string;
};

export class InternalRequestAuthError extends Error {}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signHmac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  const maxLen = Math.max(leftBuffer.length, rightBuffer.length);
  const a = Buffer.concat([leftBuffer, Buffer.alloc(maxLen - leftBuffer.length)]);
  const b = Buffer.concat([rightBuffer, Buffer.alloc(maxLen - rightBuffer.length)]);
  return timingSafeEqual(a, b) && leftBuffer.length === rightBuffer.length;
}

function parseHeader(value: string) {
  try {
    return JSON.parse(decodeBase64Url(value)) as InternalTokenHeader;
  } catch {
    throw new InternalRequestAuthError("Invalid internal request token.");
  }
}

function parseClaims(value: string) {
  try {
    return JSON.parse(decodeBase64Url(value)) as InternalRequestTokenClaims;
  } catch {
    throw new InternalRequestAuthError("Invalid internal request token.");
  }
}

function isValidClaimsShape(value: InternalRequestTokenClaims) {
  return (
    typeof value.iss === "string"
    && typeof value.aud === "string"
    && typeof value.purpose === "string"
    && typeof value.method === "string"
    && typeof value.path === "string"
    && typeof value.iat === "number"
    && typeof value.exp === "number"
    && typeof value.jti === "string"
    && value.jti.length > 0
    && (value.idempotencyKey === undefined || typeof value.idempotencyKey === "string")
    && (value.orderId === undefined || typeof value.orderId === "string")
  );
}

export function extractBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export function requireInternalRequestSigningSecret(envName: string) {
  const value = process.env[envName]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${envName}`);
  }

  return value;
}

export function signInternalRequestToken(input: SignInternalRequestTokenInput) {
  const now = Math.floor(Date.now() / 1000);
  const header: InternalTokenHeader = {
    alg: "HS256",
    typ: "internal-request"
  };
  const claims = {
    iss: input.issuer,
    aud: input.audience,
    purpose: input.purpose,
    method: input.method.toUpperCase(),
    path: input.path,
    iat: now,
    exp: now + (input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS),
    jti: randomUUID(),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.orderId ? { orderId: input.orderId } : {})
  };
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedClaims = encodeBase64Url(JSON.stringify(claims));
  const signature = signHmac(input.secret, `${encodedHeader}.${encodedClaims}`);

  return `${encodedHeader}.${encodedClaims}.${signature}`;
}

export async function verifyInternalRequestToken(
  input: VerifyInternalRequestTokenInput
): Promise<InternalRequestTokenClaims> {
  const segments = input.token.split(".");
  if (segments.length !== 3) {
    throw new InternalRequestAuthError("Invalid internal request token.");
  }

  const [encodedHeader, encodedClaims, signature] = segments;
  const header = parseHeader(encodedHeader);
  const claims = parseClaims(encodedClaims);

  if (
    header.alg !== "HS256"
    || header.typ !== "internal-request"
    || !isValidClaimsShape(claims)
  ) {
    throw new InternalRequestAuthError("Invalid internal request token.");
  }

  const expectedSignature = signHmac(input.secret, `${encodedHeader}.${encodedClaims}`);
  if (!safeEqual(signature, expectedSignature)) {
    throw new InternalRequestAuthError("Invalid internal request token.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now || claims.iat > now + CLOCK_SKEW_SECONDS) {
    throw new InternalRequestAuthError("Internal request token expired.");
  }

  if (
    claims.iss !== input.issuer
    || claims.aud !== input.audience
    || claims.purpose !== input.purpose
    || claims.method !== input.method.toUpperCase()
    || claims.path !== input.path
  ) {
    throw new InternalRequestAuthError("Internal request token rejected.");
  }

  if (input.idempotencyKey !== undefined && claims.idempotencyKey !== input.idempotencyKey) {
    throw new InternalRequestAuthError("Internal request token rejected.");
  }

  if (input.orderId !== undefined && claims.orderId !== input.orderId) {
    throw new InternalRequestAuthError("Internal request token rejected.");
  }

  const supabase = createAdminSupabaseClient();
  const expIso = new Date(claims.exp * 1000).toISOString();
  const { data, error } = await supabase.rpc("consume_internal_token_jti", {
    p_jti: claims.jti,
    p_exp: expIso
  });

  if (error) {
    throw new InternalRequestAuthError("Internal request token rejected.");
  }

  if (data !== true) {
    throw new InternalRequestAuthError("Internal request token already consumed.");
  }

  return claims;
}
