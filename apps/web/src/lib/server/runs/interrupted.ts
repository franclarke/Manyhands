import { appendStatusEventOrRollback, requireCapturedRunRecord } from "./audited-mutation";
import { RunMutationConflictError } from "./errors";
import { claimRunMutation } from "./mutation-guard";
import { invalidateRunOperation } from "./run-operation-lease";
import { isRunnerActive } from "./runner-state";
import { getRunRepository } from "./store";
import type { RunRecord } from "./schema";

/**
 * Default staleness threshold for runs in `generating` or `running`. The runner
 * writes `heartbeatAt` every few seconds; if no heartbeat lands within this
 * window the run is treated as orphaned (server restart, crash, dropped HMR).
 */
export const DEFAULT_STALE_MS = 10 * 60 * 1000;

/** Internal sentinel: the FRESH record no longer qualifies for the sweep. */
class SweepNotApplicable extends Error {
  constructor(readonly current: RunRecord) {
    super("sweep not applicable");
  }
}

/**
 * Sweep one record and mark it as `interrupted` when:
 *  - status is `created`, `generating`, `running`, or `paused`,
 *  - AND no in-process runner is active for the runId,
 *  - AND `heartbeatAt` is missing or older than `staleMs`.
 *
 * RU2 (F2B-2/I3): the transition is a single CAS mutation that re-checks
 * staleness against the FRESH record inside the per-run write lock and — in
 * the same persisted write — revokes `activeOperation` and advances the
 * mutation fence (`invalidateRunOperation`). A frozen worker that wakes up
 * after the sweep can no longer pass fencing: there is no window where the
 * run is `interrupted` but the old lease still writes. A heartbeat that
 * landed after the caller's snapshot makes the re-check skip the sweep; a
 * concurrent competing sweep loses the status expectation and observes the
 * winner's record. Cross-process safe: the claim runs inside the repository's
 * filesystem mutex and judges only durable state (plus the process-local
 * runner registry, which can only make the sweep MORE conservative).
 *
 * Returns the updated record (or the freshest record if no transition was
 * made). A `run.status.changed` event is appended durably exactly once per
 * effective transition (rollback on event failure, as everywhere else).
 */
export async function sweepRunIfStale(run: RunRecord, staleMs: number = DEFAULT_STALE_MS): Promise<RunRecord> {
  // Cheap pre-checks on the caller's snapshot: only candidates proceed to the
  // locked re-check, so list sweeps stay O(live runs).
  if (!isLiveStatus(run.status)) return run;
  if (isRunnerActive(run.runId)) return run;
  if (Date.now() - lastActivityMs(run) < staleMs) return run;

  let previous: RunRecord | undefined;
  let saved: RunRecord;
  try {
    saved = await claimRunMutation(
      run.runId,
      { status: ["created", "generating", "running", "paused"] },
      (current) => {
        // Re-judge staleness on the FRESH record: a heartbeat/resume that beat
        // us to the lock must veto the sweep instead of racing it.
        if (isRunnerActive(current.runId) || Date.now() - lastActivityMs(current) < staleMs) {
          throw new SweepNotApplicable(current);
        }
        previous = current;
        const interruptedDuring: "generating" | "running" =
          current.status === "running" || current.pausedDuring === "running" ? "running" : "generating";
        return {
          // The same write that exposes `interrupted` revokes the lease and
          // bumps the fence — the old writer is dead the instant this lands.
          ...invalidateRunOperation(current),
          status: "interrupted",
          interruptedDuring,
          errorMessage: current.errorMessage ?? "interrupted: server restart or stale heartbeat"
        };
      }
    );
  } catch (error) {
    if (error instanceof SweepNotApplicable) return error.current;
    if (error instanceof RunMutationConflictError) {
      // Someone else moved the run (competing sweep, cancel, terminal settle):
      // surface whatever they persisted instead of failing the read path.
      return getRunRepository().get(run.runId);
    }
    throw error;
  }
  return appendStatusEventOrRollback(requireCapturedRunRecord(previous, run.runId), saved, {
    actor: "system"
  });
}

export async function sweepManyIfStale(runs: RunRecord[], staleMs: number = DEFAULT_STALE_MS): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  for (const run of runs) {
    out.push(await sweepRunIfStale(run, staleMs));
  }
  return out;
}

function isLiveStatus(status: RunRecord["status"]): boolean {
  return status === "created" || status === "generating" || status === "running" || status === "paused";
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
