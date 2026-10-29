import "server-only";
import { importJWK, SignJWT, type JWK } from "jose";
import { z } from "zod";

export function offlinePosEnabled() { return process.env.POS_OFFLINE_ENABLED === "true"; }
const resource=z.object({resourceId:z.number().int().positive(),quantity:z.number().int().positive()}).strict();
export const offlineSnapshotSchema=z.object({
  terminalId:z.uuid(),epoch:z.uuid(),terminalKey:z.string().min(40).max(100),
  allocationId:z.uuid(),catalogVersion:z.uuid(),serviceDate:z.iso.date(),
  expiresAt:z.number().int().positive(),
  items:z.array(z.object({menuItemId:z.number().int().positive(),name:z.string().min(1).max(120),
    unitPrice:z.number().int().positive(),requirements:z.array(resource).min(1).max(30)}).strict()).min(1).max(100),
  budgets:z.array(resource).min(1).max(100)
}).strict();

export async function signOfflineGrant(snapshot:unknown,cashierId:string,now=Date.now()) {
  if(!offlinePosEnabled()) throw Error("Offline cash POS is disabled.");
  const data=offlineSnapshotSchema.parse(snapshot);
  const issuedAt=Math.floor(now/1000)*1000;
  const expiresAt=Math.min(data.expiresAt,issuedAt+12*60*60*1000);
  if(expiresAt<=issuedAt) throw Error("Offline allocation expired.");
  const encoded=process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64;
  const issuer=process.env.POS_OFFLINE_GRANT_ISSUER;
  if(!encoded||!issuer) throw Error("Offline signing configuration missing.");
  const jwk=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")) as JWK;
  if(jwk.kty!=="OKP"||jwk.crv!=="Ed25519"||!jwk.d) throw Error("Offline signing key must be private Ed25519.");
  const grant={version:1,grantId:crypto.randomUUID(),...data,cashierId,issuedAt,expiresAt,permissions:["cash","reprint"]};
  return new SignJWT({grant}).setProtectedHeader({alg:"EdDSA",typ:"JWT"}).setIssuer(issuer)
    .setAudience("smokehouse-offline-pos-v1").setIssuedAt(issuedAt/1000).setExpirationTime(expiresAt/1000)
    .sign(await importJWK(jwk,"EdDSA"));
}
