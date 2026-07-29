import { globalSingleton } from "../global-singleton";

/**
 * Per-run AbortControllers for in-process execution. The runner registers a
 * controller when it starts driving the engine; Cancel and the budget watchdog
 * call `abortRun` to actually kill the in-flight executor subprocess (not just
 * relabel the run). Mirrors `runner-state.ts`. On globalThis: the registering
 * runner and the aborting route live in different Next route bundles.
 */
const controllers = globalSingleton(
  "run-abort-registry:v2",
  () => new Map<string, { operationId: string; controller: AbortController }>()
);

export function createRunAbort(runId: string, operationId: string): AbortController {
  const controller = new AbortController();
  controllers.set(runId, { operationId, controller });
  return controller;
}

export function getRunAbort(runId: string): AbortController | undefined {
  return controllers.get(runId)?.controller;
}

/** Aborts the run's in-flight execution if a controller is registered. */
export function abortRun(runId: string): boolean {
  const entry = controllers.get(runId);
  if (entry === undefined) {
    return false;
  }
  entry.controller.abort();
  return true;
}

export function disposeRunAbort(runId: string, operationId: string): void {
  if (controllers.get(runId)?.operationId === operationId) {
    controllers.delete(runId);
  }
}
