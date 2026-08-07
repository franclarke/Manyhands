import { DEFAULT_STALE_MS } from "./interrupted";
import { classifyRunLiveness, type RunLivenessVerdict } from "./liveness";
import { hasLiveRunProcesses } from "./process-evidence";
import { getRunRepository } from "./store";
import type { RunRecord } from "./schema";

/**
 * Turns a liveness verdict into the one action the product takes about it.
 *
 * Ending an abandoned run goes through the same verified cancellation a human
 * would trigger — kill the process trees, then record the terminal transition —
 * rather than a second way to finish a run. One path means one set of
 * guarantees to reason about, and it is already the path that refuses to claim
 * `allDead` without evidence.
 *
 * Stage 5 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 */

export interface RunLivenessSupervisorOptions {
  hasLiveProcesses?(runId: string): Promise<boolean>;
  cancelRun(runId: string, reason: string): Promise<unknown>;
  staleAfterMs?: number;
  now?(): string;
}

export async function superviseRunLiveness(
  run: RunRecord,
  options: RunLivenessSupervisorOptions
): Promise<RunLivenessVerdict> {
  const probe = options.hasLiveProcesses ?? hasLiveRunProcesses;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_MS;
  const now = options.now?.() ?? new Date().toISOString();
  const shape = {
    lifecycle: run.projection.lifecycle,
    activeOperation: run.activeOperation,
    staleAfterMs,
    now
  };

  // Classify optimistically first. Reading the process table costs a
  // subprocess, and every verdict except "the heartbeat expired" is already
  // decided without it — a fresh heartbeat is proof of life on its own.
  const optimistic = classifyRunLiveness({ ...shape, ownerProcessPresent: true });
  if (optimistic.kind !== "owner_silent" && optimistic.kind !== "unowned") return optimistic;

  if (optimistic.kind === "unowned") {
    // Nothing holds the journal fence, so no writer can advance this run: it is
    // not slow, it is stranded. Any process still alive is an orphan, and the
    // cancellation path is what kills those.
    await options.cancelRun(run.runId, "Run holds no active operation and cannot progress; ending it and stopping any orphaned processes.");
    return optimistic;
  }

  const verdict = classifyRunLiveness({ ...shape, ownerProcessPresent: await probe(run.runId) });
  if (verdict.kind !== "owner_absent") return verdict;

  await options.cancelRun(
    run.runId,
    `Run owner ${verdict.operationId} left no live process and has been silent for ${Math.round(verdict.silentForMs / 1000)}s; ending the run.`
  );
  return verdict;
}

/**
 * Supervision as a read-path side effect: opening a run is when a stalled one
 * needs to stop pretending it is working.
 *
 * It never fails the read. A run detail that will not render because
 * cancellation hit a lost lease is a worse outcome than a run that shows one
 * more stale heartbeat, and the next read tries again. The failure is logged
 * rather than swallowed silently.
 *
 * Deliberately not wired into the run LIST: that is a hot path, and probing the
 * process table once per listed run would trade a rendering cost for exactly
 * the kind of sweep the list was optimised to avoid.
 */
export async function reconcileRunLiveness(run: RunRecord): Promise<RunRecord> {
  try {
    const verdict = await superviseRunLiveness(run, {
      cancelRun: async (runId, reason) => {
        const { cancelRunV2 } = await import("./v2/command-host");
        await cancelRunV2(runId, reason);
      }
    });
    if (verdict.kind !== "owner_absent" && verdict.kind !== "unowned") return run;
    return await getRunRepository().get(run.runId);
  } catch (error) {
    console.warn(`[runs] liveness supervision failed for ${run.runId}`, error);
    return run;
  }
}
