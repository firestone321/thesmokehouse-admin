import "server-only";
import {SignJWT,importJWK,calculateJwkThumbprint,type JWK} from "jose";
export async function signFundingRecord(kind:"funding"|"activation",record:Record<string,unknown>){
 const encoded=process.env.POS_OFFLINE_GRANT_PRIVATE_JWK_B64,issuer=process.env.POS_OFFLINE_GRANT_ISSUER;
 if(!encoded||!issuer)throw Error("Funding signing configuration missing");
 const key=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")) as JWK;
 if(key.kty!=="OKP"||key.crv!=="Ed25519"||!key.d)throw Error("Private Ed25519 signing key required");
 // Permanent funding evidence is not cash authorization. Original cashier grants still expire.
 return new SignJWT({[kind]:record}).setProtectedHeader({alg:"EdDSA",kid:await calculateJwkThumbprint(key)})
 .setIssuer(issuer).setAudience(kind==="funding"?"smokehouse-offline-replenishment-v1":"smokehouse-offline-replenishment-activation-v1")
 .setIssuedAt().sign(await importJWK(key,"EdDSA"));
}
