import Link from "next/link";
import {createAdminSupabaseClient} from "@/lib/supabase/server";
import {OfflineIdentityLookup} from "./offline-identity-lookup";
export async function TerminalHandover({actorId,manager}:{actorId:string;manager:boolean}){
 if(process.env.POS_OFFLINE_OPERATIONS_ENABLED!=="true")return null;
 const {data,error}=await createAdminSupabaseClient().rpc("get_pos_offline_handover_status",{p_actor:actorId});
 const risk=!!error||(data||[]).some((t:Record<string,any>)=>t.stale||t.pendingCount===null||Number(t.pendingCount)>0);
 return <details open={risk} className="surface-card my-4 rounded border p-4"><summary>Registered offline terminal status and device handover</summary>
 <p role={risk?"alert":undefined}>{risk?"Unresolved or unknown terminal activity requires manager handover review. ":""}Phones are online-only. This device cannot inspect another computer&apos;s unsynchronized local journal. Do not recreate an earlier cash sale because it is absent from the cloud.</p>
 {error?<p>Terminal status unavailable. Treat pending activity as unknown and request manager review.</p>:(data||[]).map((t:Record<string,any>)=><p key={t.terminalId+t.epoch}>Terminal {t.terminalId}: last contact {t.lastContact||"unknown"}; last reported pending {t.pendingCount??"unknown"}; {t.stale?"STALE / UNKNOWN":"recent report, not a live journal view"}.</p>)}
 <OfflineIdentityLookup/>{manager?<Link href="/pos/offline-operations">Manager reconciliation and handover approval</Link>:<p>A manager must review uncertain handovers and suspected duplicate sales.</p>}</details>;
}
