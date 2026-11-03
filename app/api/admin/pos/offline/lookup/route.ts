import {NextResponse} from "next/server";
import {z} from "zod";
import {assertSameOriginRequest,requirePosAccess} from "@/lib/auth/admin-role";
import {isLocalAuthBypassEnabled} from "@/lib/auth/local-bypass";
import {createAdminSupabaseClient} from "@/lib/supabase/server";
export async function POST(request:Request){
 if(process.env.POS_OFFLINE_OPERATIONS_ENABLED!=="true")return NextResponse.json({error:"disabled"},{status:404});
 try{assertSameOriginRequest(request);if(await isLocalAuthBypassEnabled())throw Error("Real authentication required");
 const actor=await requirePosAccess(),b=z.object({transactionId:z.uuid()}).strict().parse(await request.json());
 const {data,error}=await createAdminSupabaseClient().rpc("lookup_pos_offline_transaction",{p_actor:actor.userId,p_id:b.transactionId});
 if(error)throw Error("Lookup denied");return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"lookup_rejected"},{status:403});}
}
