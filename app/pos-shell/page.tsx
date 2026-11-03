import {OfflinePosEntry} from "@/components/pos/offline-pos-entry";
import {offlinePosEnabled} from "@/lib/pos/offline-grant";
// Public, data-free shell. Activation is a deployment/build decision, never browser storage.
export const dynamic="force-static";
export default function PosShell(){
 const enabled=offlinePosEnabled();
 return <><meta name="smokehouse-offline-pos" content={enabled?"enabled":"disabled"}/>{enabled?<OfflinePosEntry/>:<p role="alert" className="surface-card rounded-2xl p-4">Offline cash sales are disabled for this Admin deployment. Use the connected POS.</p>}</>;
}
