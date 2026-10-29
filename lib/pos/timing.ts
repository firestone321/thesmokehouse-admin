/** Never pass request bodies, JWTs, references, receipt contents or identities here. */
export type PosStage = "sale_submission_initiated" | "api_request_dispatched" | "authentication_completed" |
  "role_verification_completed" | "sale_rpc_completed" | "receipt_data_prepared" | "hardware_authorization_prepared" |
  "api_response_prepared" | "api_response_received" | "drawer_request_dispatched" | "drawer_bridge_acknowledged" |
  "receipt_request_dispatched" | "receipt_bridge_acknowledged";
export function posTimer(correlationId: string) {
  const started = performance.now(); let previous = started;
  return (stage: PosStage, outcome: "ok" | "failed" | "unknown" = "ok") => {
    const now = performance.now();
    console.info(JSON.stringify({ event: "admin_pos_timing", correlationId, stage, outcome,
      elapsedMs: Math.round((now-started)*100)/100, stageMs: Math.round((now-previous)*100)/100 }));
    previous = now;
  };
}
