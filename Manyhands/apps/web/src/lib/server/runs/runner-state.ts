import { globalSingleton } from "../global-singleton";

/**
 * Tracks runIds that currently have an in-process runner attached. The SSE
 * sweep uses this to distinguish "still running" from "orphaned after a crash".
 * On globalThis: runners are marked active from one Next route bundle and
 * checked from others (sweep, mutation guard, repo lock).
 */
const active = globalSingleton("runner-state:active", () => new Set<string>());

export function markRunnerActive(runId: string): void {
  active.add(runId);
}

export function markRunnerInactive(runId: string): void {
  active.delete(runId);
}

export function isRunnerActive(runId: string): boolean {
  return active.has(runId);
}
