export class RunNotFoundError extends Error {
  constructor(id: string) {
    super(`Run not found: ${id}`);
    this.name = "RunNotFoundError";
  }
}

export class RunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunValidationError";
  }
}

export class RunLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunLifecycleError";
  }
}

/**
 * Raised when a run mutation (HITL decision, resume, restart, approval) finds
 * the run in a different state than the caller expected: another request won
 * the race, the gate was already resolved, or the record version moved on.
 * Subclasses RunLifecycleError so every route's 409 mapping applies; carries
 * the current state so the client can reconcile instead of retrying blindly.
 */
export class RunMutationConflictError extends RunLifecycleError {
  constructor(
    message: string,
    readonly currentStatus: string,
    readonly currentVersion: number
  ) {
    super(message);
    this.name = "RunMutationConflictError";
  }
}

/**
 * Raised when a run is executed with the default engine but has no target
 * repository configured. The message is actionable (D3: never fail silently).
 */
export class RepoNotConfiguredError extends Error {
  constructor(runId: string) {
    super(
      `Run ${runId} has no target repository configured. ` +
        "Set a fixture repoSpec (e.g. task-manager-api) before executing."
    );
    this.name = "RepoNotConfiguredError";
  }
}
