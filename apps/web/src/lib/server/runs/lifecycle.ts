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
  completed: [],
  failed: []
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

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed";
}
