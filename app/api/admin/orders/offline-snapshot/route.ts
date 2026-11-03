import {NextResponse} from "next/server";
import {AdminAuthorizationError,assertSameOriginRequest} from "@/lib/auth/admin-role";
import {parseJsonBody} from "@/lib/validation/http";
import {createOrdersSnapshot,snapshotRequestSchema} from "@/lib/orders/offline-server";
export async function POST(request:Request){const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});try{assertSameOriginRequest(request);const body=await parseJsonBody(request,snapshotRequestSchema,{maxBytes:12000});return respond(await createOrdersSnapshot(body));}catch(e){return respond({ok:false,message:e instanceof AdminAuthorizationError?e.message:"Offline Orders snapshot unavailable."},e instanceof AdminAuthorizationError?e.status:503);}}
