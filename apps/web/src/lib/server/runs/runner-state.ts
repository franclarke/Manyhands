import { globalSingleton } from "../global-singleton";

/**
 * Tracks runIds that currently have an in-process runner attached. The SSE
 * sweep uses this to distinguish "still running" from "orphaned after a crash".
 * On globalThis: runners are marked active from one Next route bundle and
 * checked from others (sweep, mutation guard, repo lock).
 */
const active = globalSingleton("runner-state:active", () => new Set<string>());
const backgroundTasks = globalSingleton(
  "runner-state:background-tasks",
  () => new Map<string, Set<Promise<void>>>()
);

export function markRunnerActive(runId: string): void {
  active.add(runId);
}

export function tryMarkRunnerActive(runId: string): boolean {
  if (active.has(runId)) {
    return false;
  }
  active.add(runId);
  return true;
}

export function markRunnerInactive(runId: string): void {
  active.delete(runId);
}

export function isRunnerActive(runId: string): boolean {
  return active.has(runId);
}

export function startRunBackgroundTask(
  runId: string,
  label: string,
  task: () => Promise<void>
): void {
  const tasks = backgroundTasks.get(runId) ?? new Set<Promise<void>>();
  backgroundTasks.set(runId, tasks);

  const tracked = Promise.resolve()
    .then(task)
    .catch((error) => {
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
  task: () => Promise<void>
): void {
  const predecessors = Array.from(backgroundTasks.get(runId) ?? []);
  startRunBackgroundTask(runId, label, async () => {
    await Promise.allSettled(predecessors);
    await task();
  });
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
