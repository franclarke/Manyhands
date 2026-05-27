/**
 * Tracks runIds that currently have an in-process runner attached. The SSE
 * sweep uses this to distinguish "still running" from "orphaned after a crash".
 */
const active = new Set<string>();

export function markRunnerActive(runId: string): void {
  active.add(runId);
}

export function markRunnerInactive(runId: string): void {
  active.delete(runId);
}

export function isRunnerActive(runId: string): boolean {
  return active.has(runId);
}
