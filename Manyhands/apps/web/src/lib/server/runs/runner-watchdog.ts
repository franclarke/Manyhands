import { abortRun } from "./run-abort-registry";
import { publishRunEvent } from "./event-bus";
import { getRunRepository } from "./store";

export function startBudgetWatchdog(runId: string, maxWallClockMs: number | undefined): () => void {
  if (maxWallClockMs === undefined) {
    return () => undefined;
  }
  const timer = setTimeout(() => {
    void (async () => {
      const repo = getRunRepository();
      const current = await repo.get(runId).catch(() => null);
      if (current !== null && current.status === "running") {
        await repo.save({
          ...current,
          status: "interrupted",
          interruptedDuring: "running",
          errorMessage: `interrupted: wall-clock budget of ${maxWallClockMs}ms exceeded`
        });
        abortRun(runId);
        publishRunEvent(runId, { kind: "status.changed", status: "interrupted", at: new Date().toISOString() });
      }
    })();
  }, maxWallClockMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return () => clearTimeout(timer);
}
