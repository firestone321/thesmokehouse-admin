import "server-only";
import { createDashboardSeedData } from "@/lib/dashboard/mock-data";

export async function getDashboardSeedSnapshot() {
  return {
    source: "mock" as const,
    note: "Live dashboard queries are intentionally not wired yet so shared database reads can be introduced with explicit, server-side contracts.",
    data: createDashboardSeedData(new Date())
  };
}
