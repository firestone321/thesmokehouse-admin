import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { calculateJwkThumbprint, importJWK, SignJWT, type JWK } from "jose";

export type CanonicalPosReceipt = {
  saleId: string;
  date: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  total: number;
  paymentMethod: "cash" | "mobile_money" | "card";
};

export type PosHardwareInstructions = {
  status: "ready";
  bridgeUrl: string;
  receipt: CanonicalPosReceipt;
  printAuthorization: string;
  drawerAuthorization?: string;
};

type SigningJwk = JWK & { kty: "OKP"; crv: "Ed25519"; x: string; d: string };
type HardwareConfig = {
  bridgeUrl: string;
  issuer: string;
  audience: string;
  privateJwk: SigningJwk;
  publicJwk: JWK;
  keyId: string;
};

function isEnabled(): boolean {
  return process.env.POS_HARDWARE_BRIDGE_ENABLED?.trim().toLowerCase() === "true";
}

function requiredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`POS hardware bridge is enabled but ${name} is not configured.`);
  return value;
}

function readSigningJwk(): SigningJwk {
  try {
    const decoded = Buffer.from(requiredValue("POS_HARDWARE_JWK_PRIVATE_KEY_B64"), "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<SigningJwk>;
    if (parsed.kty !== "OKP" || parsed.crv !== "Ed25519" || typeof parsed.x !== "string" || typeof parsed.d !== "string") {
      throw new Error("not an Ed25519 private JWK");
    }
    return parsed as SigningJwk;
  } catch (error) {
    if (error instanceof Error && error.message.includes("POS hardware bridge")) throw error;
    throw new Error("POS hardware bridge signing key is invalid.");
  }
}

function readConfig(): HardwareConfig | null {
  if (!isEnabled()) return null;

  const bridgeUrl = requiredValue("POS_HARDWARE_BRIDGE_URL");
  let parsedBridgeUrl: URL;
  try {
    parsedBridgeUrl = new URL(bridgeUrl);
  } catch {
    throw new Error("POS_HARDWARE_BRIDGE_URL must be a valid URL.");
  }
  if (parsedBridgeUrl.protocol !== "http:" || parsedBridgeUrl.hostname !== "127.0.0.1") {
    throw new Error("POS_HARDWARE_BRIDGE_URL must target the local bridge at http://127.0.0.1.");
  }

  const privateJwk = readSigningJwk();
  const publicJwk = { kty: "OKP" as const, crv: "Ed25519" as const, x: privateJwk.x, use: "sig", alg: "EdDSA" };
  return {
    bridgeUrl: parsedBridgeUrl.origin,
    issuer: process.env.POS_HARDWARE_JWT_ISSUER?.trim() || "firestone-smokehouse",
    audience: process.env.POS_HARDWARE_JWT_AUDIENCE?.trim() || "smokehouse-pos-bridge",
    privateJwk,
    publicJwk,
    keyId: privateJwk.kid?.trim() || ""
  };
}

export function isPosHardwareBridgeEnabled(): boolean {
  return isEnabled();
}

export async function getPosHardwareJwks(): Promise<{ keys: JWK[] } | null> {
  const config = readConfig();
  if (!config) return null;
  const keyId = config.keyId || (await calculateJwkThumbprint(config.publicJwk));
  return { keys: [{ ...config.publicJwk, kid: keyId }] };
}

async function signHardwareAction(config: HardwareConfig, action: "print_receipt" | "open_drawer", saleId: string): Promise<string> {
  const keyId = config.keyId || (await calculateJwkThumbprint(config.publicJwk));
  const privateKey = await importJWK(config.privateJwk, "EdDSA");
  return new SignJWT({ action, sale_id: saleId })
    .setProtectedHeader({ alg: "EdDSA", kid: keyId, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setJti(randomUUID())
    .setExpirationTime("60s")
    .sign(privateKey);
}

/** Called after a committed POS sale; null preserves existing behaviour while disabled. */
export async function issuePosHardwareInstructions(receipt: CanonicalPosReceipt): Promise<PosHardwareInstructions | null> {
  if (receipt.paymentMethod !== "cash") return null;

  const config = readConfig();
  if (!config) return null;
  const printAuthorization = await signHardwareAction(config, "print_receipt", receipt.saleId);
  const drawerAuthorization = await signHardwareAction(config, "open_drawer", receipt.saleId);
  return {
    status: "ready",
    bridgeUrl: config.bridgeUrl,
    receipt,
    printAuthorization,
    drawerAuthorization
  };
}
