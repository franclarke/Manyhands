/**
 * Typed error hierarchy for the execution pipeline.
 * Each error carries structured context fields for diagnostics and tracing.
 * All extend ExecutionCoreError and include a `code` string for serialization.
 */

// ── Base ────────────────────────────────────────────────────────

export class ExecutionCoreError extends Error {
  public readonly code: string;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "ExecutionCoreError";
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }

  static is(err: unknown): err is ExecutionCoreError {
    return err instanceof ExecutionCoreError;
  }
}

// ── Worktree ────────────────────────────────────────────────────

export type WorktreeOperation = "create" | "clean" | "detect";

export class WorktreeError extends ExecutionCoreError {
  public readonly taskId: string;
  public readonly worktreePath: string | undefined;
  public readonly operation: WorktreeOperation;

  constructor(
    message: string,
    taskId: string,
    operation: WorktreeOperation,
    worktreePath?: string,
    cause?: unknown
  ) {
    super(message, "WORKTREE_ERROR", cause);
    this.name = "WorktreeError";
    this.taskId = taskId;
    this.operation = operation;
    this.worktreePath = worktreePath;
  }

  static override is(err: unknown): err is WorktreeError {
    return err instanceof WorktreeError;
  }
}

// ── Agent execution ─────────────────────────────────────────────

export class AgentExecutionError extends ExecutionCoreError {
  public readonly taskId: string;
  public readonly exitCode: number;
  public readonly timedOut: boolean;
  public readonly durationMs: number;

  constructor(
    message: string,
    taskId: string,
    exitCode: number,
    timedOut: boolean,
    durationMs: number,
    cause?: unknown
  ) {
    super(message, "AGENT_EXECUTION_ERROR", cause);
    this.name = "AgentExecutionError";
    this.taskId = taskId;
    this.exitCode = exitCode;
    this.timedOut = timedOut;
    this.durationMs = durationMs;
  }

  static override is(err: unknown): err is AgentExecutionError {
    return err instanceof AgentExecutionError;
  }
}

// ── Scope violation ─────────────────────────────────────────────

export class ScopeViolationError extends ExecutionCoreError {
  public readonly taskId: string;
  public readonly violations: string[];

  constructor(message: string, taskId: string, violations: string[], cause?: unknown) {
    super(message, "SCOPE_VIOLATION_ERROR", cause);
    this.name = "ScopeViolationError";
    this.taskId = taskId;
    this.violations = violations;
  }

  static override is(err: unknown): err is ScopeViolationError {
    return err instanceof ScopeViolationError;
  }
}

// ── Validation ──────────────────────────────────────────────────

export class ExecutionValidationError extends ExecutionCoreError {
  public readonly taskId: string;
  public readonly command: string;
  public readonly exitCode: number;
  public readonly output: string;

  constructor(
    message: string,
    taskId: string,
    command: string,
    exitCode: number,
    output: string,
    cause?: unknown
  ) {
    super(message, "VALIDATION_ERROR", cause);
    this.name = "ExecutionValidationError";
    this.taskId = taskId;
    this.command = command;
    this.exitCode = exitCode;
    this.output = output;
  }

  static override is(err: unknown): err is ExecutionValidationError {
    return err instanceof ExecutionValidationError;
  }
}

// ── Integration ─────────────────────────────────────────────────

export type IntegrationPhase = "cherry_pick" | "repair" | "validation";

export class IntegrationError extends ExecutionCoreError {
  public readonly compositeTaskId: string;
  public readonly childTaskIds: string[];
  public readonly phase: IntegrationPhase;

  constructor(
    message: string,
    compositeTaskId: string,
    childTaskIds: string[],
    phase: IntegrationPhase,
    cause?: unknown
  ) {
    super(message, "INTEGRATION_ERROR", cause);
    this.name = "IntegrationError";
    this.compositeTaskId = compositeTaskId;
    this.childTaskIds = childTaskIds;
    this.phase = phase;
  }

  static override is(err: unknown): err is IntegrationError {
    return err instanceof IntegrationError;
  }
}

// ── Unexpected commit ───────────────────────────────────────────

export class UnexpectedCommitError extends ExecutionCoreError {
  public readonly taskId: string;
  public readonly commitSha: string;
  public readonly policy: "reject" | "accept";

  constructor(
    message: string,
    taskId: string,
    commitSha: string,
    policy: "reject" | "accept",
    cause?: unknown
  ) {
    super(message, "UNEXPECTED_COMMIT_ERROR", cause);
    this.name = "UnexpectedCommitError";
    this.taskId = taskId;
    this.commitSha = commitSha;
    this.policy = policy;
  }

  static override is(err: unknown): err is UnexpectedCommitError {
    return err instanceof UnexpectedCommitError;
  }
}

// ── Run execution (orchestrator-level) ──────────────────────────

export type RunExecutionPhase =
  | "validate"
  | "schedule"
  | "leaf"
  | "integration"
  | "validation"
  | "cleanup";

/**
 * Raised by the orchestrator when a run cannot proceed: a malformed graph
 * (phase "validate"), an unschedulable task (phase "schedule"), etc. Leaf,
 * scope, and validation *outcomes* are reported as results — not thrown — so
 * this error is reserved for genuinely exceptional, run-aborting conditions.
 */
export class RunExecutionError extends ExecutionCoreError {
  public readonly phase: RunExecutionPhase;
  public readonly runId: string | undefined;

  constructor(message: string, phase: RunExecutionPhase, runId?: string, cause?: unknown) {
    super(message, "RUN_EXECUTION_ERROR", cause);
    this.name = "RunExecutionError";
    this.phase = phase;
    this.runId = runId;
  }

  static override is(err: unknown): err is RunExecutionError {
    return err instanceof RunExecutionError;
  }
}
