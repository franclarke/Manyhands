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
 * A run's persisted or requested configuration cannot be resolved to a single
 * unambiguous StageSelection — contradictory canonical/legacy fields, or a bare
 * legacy model string that maps to no registered executor. Extends
 * RunValidationError so the request boundary surfaces it as a 400 (never a
 * silent remap: corrupt config fails loudly, U2A-2).
 */
export class RunConfigurationError extends RunValidationError {
  constructor(message: string) {
    super(message);
    this.name = "RunConfigurationError";
  }
}

/**
 * The configured planning executor cannot be used for this invocation. This is
 * a user-correctable runtime readiness problem, not invalid request syntax or
 * an internal 500. Routes expose it as a lifecycle conflict (409).
 */
export class PlanningExecutorUnavailableError extends RunLifecycleError {
  constructor(message: string) {
    super(message);
    this.name = "PlanningExecutorUnavailableError";
  }
}

/** Runtime readiness failed after a selection was declared valid. */
export class ExecutorUnavailableError extends RunLifecycleError {
  constructor(message: string) {
    super(message);
    this.name = "ExecutorUnavailableError";
  }
}

/** The CLI exists, but the selected account/installation rejects the model. */
export class ExecutorModelUnavailableError extends RunLifecycleError {
  constructor(message: string) {
    super(message);
    this.name = "ExecutorModelUnavailableError";
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
        "Select a workspace or set a localPath repoSpec before executing."
    );
    this.name = "RepoNotConfiguredError";
  }
}
