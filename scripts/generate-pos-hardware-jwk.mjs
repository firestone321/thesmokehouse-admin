import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
const privateJwk = await exportJWK(privateKey);
const publicJwk = await exportJWK(publicKey);
const kid = await calculateJwkThumbprint(publicJwk);

privateJwk.kid = kid;
privateJwk.use = "sig";
privateJwk.alg = "EdDSA";

const encodedPrivateJwk = Buffer.from(JSON.stringify(privateJwk), "utf8").toString("base64url");
console.log("Store this as a deployment secret. Do not commit or paste it into browser code:");
console.log(`POS_HARDWARE_JWK_PRIVATE_KEY_B64=${encodedPrivateJwk}`);
console.log(`Public JWKS endpoint after enabling: https://admin.firestonesmokehouse.com/api/pos-hardware/jwks (kid: ${kid})`);
