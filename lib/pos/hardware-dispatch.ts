/** Await the drawer request before issuing the receipt, including on failure.
 * Concurrent HTTP requests cannot guarantee order in the shared printer queue. */
export async function dispatchCashHardware(drawer: () => Promise<void>, receipt: () => Promise<void>): Promise<void> {
  try { await drawer(); } finally { await receipt(); }
}
