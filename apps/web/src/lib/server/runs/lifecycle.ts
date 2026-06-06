import { RunLifecycleError } from "./errors";
import type { RunStatus } from "./schema";

const ALLOWED_TRANSITIONS: Record<RunStatus, ReadonlyArray<RunStatus>> = {
  created: ["generating", "failed"],
  generating: ["paused", "needs_review", "interrupted", "failed"],
  paused: ["generating", "running", "needs_review", "interrupted", "failed"],
  needs_review: ["approved", "failed"],
  approved: ["running", "needs_review", "failed"],
  running: ["paused", "completed", "interrupted", "failed"],
  interrupted: ["generating", "running", "failed"],
  // Re-open (review actions): let the user re-run a node after a finished run.
  completed: ["approved"],
  failed: ["approved"]
};

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new RunLifecycleError(`Illegal status transition: ${from} → ${to}`);
  }
}

export function canPause(status: RunStatus): boolean {
  return status === "generating" || status === "running";
}

export function canRestart(status: RunStatus): boolean {
  return status === "interrupted" || status === "failed";
}

/** Minimal run shape the restart route needs to choose which pipeline to resume. */
export interface RestartContext {
  approvedAt?: string | undefined;
  planning?: unknown;
  failedDuring?: "generating" | "running" | undefined;
  interruptedDuring?: "generating" | "running" | undefined;
}

/**
 * A restart resumes EXECUTION (not planning) when the run already reached
 * approval with a generated plan, or its last failure/interruption happened
 * during execution. Otherwise it restarts planning.
 *
 * Without a plan there is nothing to execute, so we always restart planning —
 * even if `approvedAt` lingers from a prior cycle. This is the signal that was
 * missing before: a run that *failed during execution* (e.g. repo provisioning)
 * never recorded its phase, so restart wrongly re-ran planning.
 */
export function restartResumesExecution(run: RestartContext): boolean {
  if (run.planning === undefined) {
    return false;
  }
  return (
    run.approvedAt !== undefined ||
    run.failedDuring === "running" ||
    run.interruptedDuring === "running"
  );
}

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed";
}
