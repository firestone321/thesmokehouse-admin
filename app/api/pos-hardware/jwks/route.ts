import { NextResponse } from "next/server";
import { getPosHardwareJwks } from "@/lib/pos/hardware-bridge";

export const runtime = "nodejs";

/** Public signing keys only. The private Ed25519 JWK remains a deployment secret. */
export async function GET() {
  try {
    const jwks = await getPosHardwareJwks();
    if (!jwks) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(jwks, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
}
