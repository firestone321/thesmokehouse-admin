import {NextResponse} from "next/server";
import {z} from "zod";
import {assertSameOriginRequest,AdminAuthorizationError} from "@/lib/auth/admin-role";
import {requireOfflineManager,signManagementPermit} from "@/lib/pos/offline-operations";
import {createAdminSupabaseClient} from "@/lib/supabase/server";
export async function POST(request:Request){
 try{
 assertSameOriginRequest(request);const actor=await requireOfflineManager();
 const b=z.object({terminalId:z.uuid(),epoch:z.uuid(),allocationId:z.uuid(),reason:z.string().trim().min(10).max(1800)}).strict().parse(await request.json());
 const {data,error}=await createAdminSupabaseClient().from("pos_offline_allocations").select("id").eq("id",b.allocationId).eq("terminal_id",b.terminalId).eq("epoch",b.epoch).maybeSingle();
 if(error||!data)return NextResponse.json({error:"Unknown terminal allocation"},{status:409});
 const {error:audit}=await createAdminSupabaseClient().rpc("manage_pos_offline_terminal",{p_manager:actor.userId,p_terminal:b.terminalId,p_epoch:b.epoch,p_action:"authorize_closure",p_reason:b.reason+" Allocation "+b.allocationId,p_decision:crypto.randomUUID()});if(audit)return NextResponse.json({error:"Closure authorization audit failed"},{status:409});
 return NextResponse.json({token:await signManagementPermit(b.terminalId,b.epoch,b.allocationId,actor.userId)},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:"Manager closure request rejected"},{status:error instanceof AdminAuthorizationError?error.status:422});}
}
