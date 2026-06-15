import { globalSingleton } from "../global-singleton";

/**
 * Per-run AbortControllers for in-process execution. The runner registers a
 * controller when it starts driving the engine; Cancel and the budget watchdog
 * call `abortRun` to actually kill the in-flight executor subprocess (not just
 * relabel the run). Mirrors `runner-state.ts`. On globalThis: the registering
 * runner and the aborting route live in different Next route bundles.
 */
const controllers = globalSingleton(
  "run-abort-registry",
  () => new Map<string, AbortController>()
);

export function createRunAbort(runId: string): AbortController {
  const controller = new AbortController();
  controllers.set(runId, controller);
  return controller;
}

export function getRunAbort(runId: string): AbortController | undefined {
  return controllers.get(runId);
}

/** Aborts the run's in-flight execution if a controller is registered. */
export function abortRun(runId: string): boolean {
  const controller = controllers.get(runId);
  if (controller === undefined) {
    return false;
  }
  controller.abort();
  return true;
}

export function disposeRunAbort(runId: string): void {
  controllers.delete(runId);
}
