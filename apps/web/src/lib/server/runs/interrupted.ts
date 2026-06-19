import { isRunnerActive } from "./runner-state";
import type { RunRecord } from "./schema";
import { saveRunWithRequiredStatusEvent } from "./audited-mutation";

/**
 * Default staleness threshold for runs in `generating` or `running`. The runner
 * writes `heartbeatAt` every few seconds; if no heartbeat lands within this
 * window the run is treated as orphaned (server restart, crash, dropped HMR).
 */
export const DEFAULT_STALE_MS = 10 * 60 * 1000;

/**
 * Sweep one record and mark it as `interrupted` when:
 *  - status is `generating`, `running`, or `paused`,
 *  - AND no in-process runner is active for the runId,
 *  - AND `heartbeatAt` is missing or older than `staleMs`.
 *
 * Returns the updated record (or the original if no transition was made).
 * Mutations are persisted and a `status.changed` event is published.
 */
export async function sweepRunIfStale(run: RunRecord, staleMs: number = DEFAULT_STALE_MS): Promise<RunRecord> {
  if (!isLiveStatus(run.status)) return run;
  if (isRunnerActive(run.runId)) return run;

  const nowMs = Date.now();
  const lastSeenMs = lastActivityMs(run);
  if (nowMs - lastSeenMs < staleMs) return run;

  const interruptedDuring: "generating" | "running" =
    run.status === "running" || run.pausedDuring === "running" ? "running" : "generating";

  const next: RunRecord = {
    ...run,
    status: "interrupted",
    interruptedDuring,
    errorMessage: run.errorMessage ?? "interrupted: server restart or stale heartbeat"
  };
  return saveRunWithRequiredStatusEvent(run, next);
}

export async function sweepManyIfStale(runs: RunRecord[], staleMs: number = DEFAULT_STALE_MS): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  for (const run of runs) {
    out.push(await sweepRunIfStale(run, staleMs));
  }
  return out;
}

function isLiveStatus(status: RunRecord["status"]): boolean {
  return status === "generating" || status === "running" || status === "paused";
}

function lastActivityMs(run: RunRecord): number {
  const candidates = [run.heartbeatAt, run.updatedAt, run.startedAt, run.createdAt].filter(
    (value): value is string => value !== undefined
  );
  let best = 0;
  for (const value of candidates) {
    const ms = new Date(value).getTime();
    if (!Number.isNaN(ms) && ms > best) best = ms;
  }
  return best;
}
