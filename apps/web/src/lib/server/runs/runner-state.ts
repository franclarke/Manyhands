import { globalSingleton } from "../global-singleton";

/**
 * Tracks runIds that currently have an in-process runner attached. The SSE
 * sweep uses this to distinguish "still running" from "orphaned after a crash".
 * On globalThis: runners are marked active from one Next route bundle and
 * checked from others (sweep, mutation guard, repo lock).
 */
const active = globalSingleton(
  "runner-state:active-v2",
  () => new Map<string, string>()
);
const backgroundTasks = globalSingleton(
  "runner-state:background-tasks",
  () => new Map<string, Set<Promise<void>>>()
);

export type BackgroundTaskErrorHandler = (error: unknown) => void | Promise<void>;

export function markRunnerActive(runId: string, operationId = "legacy"): void {
  active.set(runId, operationId);
}

export function tryMarkRunnerActive(
  runId: string,
  operationId = "legacy",
  allowVerifiedTakeover = false
): boolean {
  if (active.has(runId) && !allowVerifiedTakeover) {
    return false;
  }
  active.set(runId, operationId);
  return true;
}

export function markRunnerInactive(runId: string, operationId?: string): void {
  if (operationId === undefined || active.get(runId) === operationId) {
    active.delete(runId);
  }
}

export function isRunnerActive(runId: string): boolean {
  return active.has(runId);
}

export function startRunBackgroundTask(
  runId: string,
  label: string,
  task: () => Promise<void>,
  onError?: BackgroundTaskErrorHandler
): void {
  const tasks = backgroundTasks.get(runId) ?? new Set<Promise<void>>();
  backgroundTasks.set(runId, tasks);

  const tracked = Promise.resolve()
    .then(task)
    .catch(async (error) => {
      let handlerError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await onError?.(error);
          handlerError = undefined;
          break;
        } catch (candidateError) {
          handlerError = candidateError;
          if (attempt < 2) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      if (handlerError !== undefined) {
        console.error(`[Runner] FATAL: background task failure could not be persisted after retry for "${label}" in run ${runId}:`, handlerError);
      }
      console.error(`[Runner] Background task "${label}" failed for run ${runId}:`, error);
    })
    .finally(() => {
      tasks.delete(tracked);
      if (tasks.size === 0) {
        backgroundTasks.delete(runId);
      }
    });

  tasks.add(tracked);
}

export function startRunBackgroundTaskAfterCurrent(
  runId: string,
  label: string,
  task: () => Promise<void>,
  onError?: BackgroundTaskErrorHandler
): void {
  const predecessors = Array.from(backgroundTasks.get(runId) ?? []);
  startRunBackgroundTask(runId, label, async () => {
    await Promise.allSettled(predecessors);
    await task();
  }, onError);
}

export async function drainRunBackgroundTasks(runId: string): Promise<void> {
  while (true) {
    const tasks = backgroundTasks.get(runId);
    if (tasks === undefined || tasks.size === 0) {
      return;
    }
    await Promise.allSettled(Array.from(tasks));
  }
}

export async function drainAllRunBackgroundTasksForTests(): Promise<void> {
  while (backgroundTasks.size > 0) {
    const tasks = Array.from(backgroundTasks.values()).flatMap((set) => Array.from(set));
    await Promise.allSettled(tasks);
  }
}
