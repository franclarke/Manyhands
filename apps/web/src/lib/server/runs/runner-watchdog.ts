import { cancelRun } from "./cancel-service";
import { getRunRepository } from "./store";
import type { RunOperationLease } from "./schema";

export function startBudgetWatchdog(
  runId: string,
  maxWallClockMs: number | undefined,
  lease?: RunOperationLease
): () => void {
  if (maxWallClockMs === undefined) {
    return () => undefined;
  }
  const timer = setTimeout(() => {
    void (async () => {
      const repo = getRunRepository();
      const current = await repo.get(runId).catch(() => null);
      if (current !== null && current.status === "running") {
        await cancelRun(runId, {
          ...(lease !== undefined ? { operationLease: lease } : {}),
          actor: "system",
          reason: `interrupted: wall-clock budget of ${maxWallClockMs}ms exceeded`
        });
      }
    })().catch((error) => {
      console.error(`[runs] budget watchdog failed for run ${runId}`, error);
    });
  }, maxWallClockMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return () => clearTimeout(timer);
}
