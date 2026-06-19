import { RunLifecycleError } from "./errors";
import type { RunRecord, RunStatus } from "./schema";

const ALLOWED_TRANSITIONS: Record<RunStatus, ReadonlyArray<RunStatus>> = {
  created: ["generating", "failed"],
  generating: ["paused", "needs_review", "interrupted", "failed"],
  paused: ["generating", "running", "needs_review", "interrupted", "failed"],
  needs_review: ["approved", "failed"],
  approved: ["running", "needs_review", "failed"],
  running: ["paused", "completed", "completed_with_accepted", "interrupted", "failed"],
  interrupted: ["generating", "running", "failed"],
  // Re-open (review actions): let the user re-run a node after a finished run.
  completed: ["approved"],
  completed_with_accepted: ["approved"],
  failed: ["approved", "generating"]
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

export type RunLifecycleAction =
  | "start"
  | "pause"
  | "resume"
  | "cancel"
  | "answer_gate"
  | "approve_plan"
  | "replan"
  | "restart"
  | "fork"
  | "manual_node_run"
  | "manual_node_review"
  | "manual_node_rerun";

const ACTION_ALLOWED_STATUSES: Record<RunLifecycleAction, ReadonlyArray<RunStatus>> = {
  start: ["approved"],
  pause: ["generating", "running"],
  resume: ["paused"],
  cancel: ["generating", "running", "paused"],
  answer_gate: ["paused"],
  approve_plan: ["needs_review"],
  replan: ["running"],
  restart: ["interrupted", "failed"],
  // Forking a moving run would clone a checkpoint/snapshot pair while the
  // runner may still be writing both. Keep forks to stable, user-visible states.
  fork: ["created", "paused", "needs_review", "approved", "interrupted", "completed", "completed_with_accepted", "failed"],
  manual_node_run: ["approved"],
  manual_node_review: ["approved", "completed", "completed_with_accepted", "failed"],
  manual_node_rerun: ["approved", "completed", "completed_with_accepted", "failed"]
};

export function allowedStatusesForAction(action: RunLifecycleAction): ReadonlyArray<RunStatus> {
  return ACTION_ALLOWED_STATUSES[action];
}

export function assertRunActionAllowed(
  runOrStatus: Pick<RunRecord, "status"> | RunStatus,
  action: RunLifecycleAction
): void {
  const status = typeof runOrStatus === "string" ? runOrStatus : runOrStatus.status;
  const allowed = ACTION_ALLOWED_STATUSES[action];
  if (!allowed.includes(status)) {
    throw new RunLifecycleError(
      `Cannot ${action.replaceAll("_", " ")} run from status "${status}". ` +
        `Allowed statuses: ${allowed.join(", ")}.`
    );
  }
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
  return status === "completed" || status === "completed_with_accepted" || status === "failed";
}
