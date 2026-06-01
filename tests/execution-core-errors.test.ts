import { describe, expect, it } from "vitest";
import {
  ExecutionCoreError,
  WorktreeError,
  AgentExecutionError,
  ScopeViolationError,
  ExecutionValidationError,
  IntegrationError,
  UnexpectedCommitError,
  RunExecutionError,
} from "@manyhands/execution-core";

describe("RunExecutionError", () => {
  it("carries phase and runId and is an ExecutionCoreError", () => {
    const err = new RunExecutionError("bad graph", "validate", "run-1");
    expect(err.name).toBe("RunExecutionError");
    expect(err.code).toBe("RUN_EXECUTION_ERROR");
    expect(err.phase).toBe("validate");
    expect(err.runId).toBe("run-1");
    expect(ExecutionCoreError.is(err)).toBe(true);
    expect(RunExecutionError.is(err)).toBe(true);
  });

  it("allows an undefined runId and an optional cause", () => {
    const cause = new Error("root");
    const err = new RunExecutionError("unschedulable", "schedule", undefined, cause);
    expect(err.runId).toBeUndefined();
    expect(err.cause).toBe(cause);
  });

  it("is not confused with sibling error classes", () => {
    const err = new RunExecutionError("x", "leaf");
    expect(WorktreeError.is(err)).toBe(false);
    expect(RunExecutionError.is(new WorktreeError("x", "t", "create"))).toBe(false);
  });
});

// â”€â”€ Base class â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("ExecutionCoreError", () => {
  it("constructs with message and code", () => {
    const err = new ExecutionCoreError("something broke", "TEST_ERROR");
    expect(err.message).toBe("something broke");
    expect(err.code).toBe("TEST_ERROR");
    expect(err.name).toBe("ExecutionCoreError");
    expect(err.cause).toBeUndefined();
  });

  it("accepts an optional cause", () => {
    const cause = new Error("root");
    const err = new ExecutionCoreError("wrapped", "TEST_ERROR", cause);
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    const err = new ExecutionCoreError("msg", "CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ExecutionCoreError);
  });

  it("type guard accepts ExecutionCoreError instances", () => {
    expect(ExecutionCoreError.is(new ExecutionCoreError("x", "X"))).toBe(true);
    expect(ExecutionCoreError.is(new WorktreeError("x", "t1", "create"))).toBe(true);
  });

  it("type guard rejects non-errors", () => {
    expect(ExecutionCoreError.is(null)).toBe(false);
    expect(ExecutionCoreError.is("string")).toBe(false);
    expect(ExecutionCoreError.is(new Error("plain"))).toBe(false);
  });
});

// â”€â”€ WorktreeError â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("WorktreeError", () => {
  it("constructs with all fields", () => {
    const err = new WorktreeError("create failed", "task-1", "create", "/tmp/wt/task-1");
    expect(err.message).toBe("create failed");
    expect(err.code).toBe("WORKTREE_ERROR");
    expect(err.name).toBe("WorktreeError");
    expect(err.taskId).toBe("task-1");
    expect(err.operation).toBe("create");
    expect(err.worktreePath).toBe("/tmp/wt/task-1");
  });

  it("worktreePath is optional", () => {
    const err = new WorktreeError("detect failed", "task-2", "detect");
    expect(err.worktreePath).toBeUndefined();
  });

  it("is an instance of ExecutionCoreError and Error", () => {
    const err = new WorktreeError("x", "t", "clean");
    expect(err).toBeInstanceOf(ExecutionCoreError);
    expect(err).toBeInstanceOf(Error);
  });

  it("type guard distinguishes from base class", () => {
    const wErr = new WorktreeError("x", "t", "create");
    const baseErr = new ExecutionCoreError("x", "X");
    expect(WorktreeError.is(wErr)).toBe(true);
    expect(WorktreeError.is(baseErr)).toBe(false);
  });

  it("base type guard accepts WorktreeError", () => {
    const err = new WorktreeError("x", "t", "create");
    expect(ExecutionCoreError.is(err)).toBe(true);
  });
});

// â”€â”€ AgentExecutionError â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("AgentExecutionError", () => {
  it("constructs with all fields", () => {
    const err = new AgentExecutionError("codex crashed", "task-3", 1, false, 12000);
    expect(err.code).toBe("AGENT_EXECUTION_ERROR");
    expect(err.name).toBe("AgentExecutionError");
    expect(err.taskId).toBe("task-3");
    expect(err.exitCode).toBe(1);
    expect(err.timedOut).toBe(false);
    expect(err.durationMs).toBe(12000);
  });

  it("records timeout scenario", () => {
    const err = new AgentExecutionError("timeout", "task-4", 124, true, 300000);
    expect(err.timedOut).toBe(true);
    expect(err.exitCode).toBe(124);
    expect(err.durationMs).toBe(300000);
  });

  it("type guard works correctly", () => {
    const err = new AgentExecutionError("x", "t", 1, false, 100);
    expect(AgentExecutionError.is(err)).toBe(true);
    expect(AgentExecutionError.is(new ExecutionCoreError("x", "X"))).toBe(false);
    expect(AgentExecutionError.is(null)).toBe(false);
  });

  it("inherits from ExecutionCoreError", () => {
    const err = new AgentExecutionError("x", "t", 1, false, 100);
    expect(err).toBeInstanceOf(ExecutionCoreError);
  });
});

// â”€â”€ ScopeViolationError â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("ScopeViolationError", () => {
  it("constructs with violations list", () => {
    const violations = ["src/forbidden.ts", "config/secret.json"];
    const err = new ScopeViolationError("out of scope", "task-5", violations);
    expect(err.code).toBe("SCOPE_VIOLATION_ERROR");
    expect(err.name).toBe("ScopeViolationError");
    expect(err.taskId).toBe("task-5");
    expect(err.violations).toEqual(violations);
  });

  it("type guard works correctly", () => {
    const err = new ScopeViolationError("x", "t", ["a"]);
    expect(ScopeViolationError.is(err)).toBe(true);
    expect(ScopeViolationError.is(new WorktreeError("x", "t", "create"))).toBe(false);
  });

  it("inherits from ExecutionCoreError", () => {
    const err = new ScopeViolationError("x", "t", []);
    expect(err).toBeInstanceOf(ExecutionCoreError);
  });
});

// â”€â”€ ExecutionValidationError â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("ExecutionValidationError", () => {
  it("constructs with all fields", () => {
    const err = new ExecutionValidationError(
      "tests failed", "task-6", "npm test", 1, "FAIL src/index.test.ts"
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.name).toBe("ExecutionValidationError");
    expect(err.taskId).toBe("task-6");
    expect(err.command).toBe("npm test");
    expect(err.exitCode).toBe(1);
    expect(err.output).toBe("FAIL src/index.test.ts");
  });

  it("type guard works correctly", () => {
    const err = new ExecutionValidationError("x", "t", "cmd", 1, "out");
    expect(ExecutionValidationError.is(err)).toBe(true);
    expect(ExecutionValidationError.is(new AgentExecutionError("x", "t", 1, false, 100))).toBe(false);
  });

  it("inherits from ExecutionCoreError", () => {
    const err = new ExecutionValidationError("x", "t", "cmd", 1, "out");
    expect(err).toBeInstanceOf(ExecutionCoreError);
  });
});

// â”€â”€ IntegrationError â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("IntegrationError", () => {
  it("constructs with all fields", () => {
    const err = new IntegrationError(
      "cherry-pick conflict", "comp-1", ["leaf-1", "leaf-2"], "cherry_pick"
    );
    expect(err.code).toBe("INTEGRATION_ERROR");
    expect(err.name).toBe("IntegrationError");
    expect(err.compositeTaskId).toBe("comp-1");
    expect(err.childTaskIds).toEqual(["leaf-1", "leaf-2"]);
    expect(err.phase).toBe("cherry_pick");
  });

  it("supports all integration phases", () => {
    for (const phase of ["cherry_pick", "repair", "validation"] as const) {
      const err = new IntegrationError("x", "c", ["l"], phase);
      expect(err.phase).toBe(phase);
    }
  });

  it("type guard works correctly", () => {
    const err = new IntegrationError("x", "c", ["l"], "repair");
    expect(IntegrationError.is(err)).toBe(true);
    expect(IntegrationError.is(new ScopeViolationError("x", "t", []))).toBe(false);
  });

  it("inherits from ExecutionCoreError", () => {
    const err = new IntegrationError("x", "c", ["l"], "validation");
    expect(err).toBeInstanceOf(ExecutionCoreError);
  });
});

// â”€â”€ UnexpectedCommitError â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("UnexpectedCommitError", () => {
  it("constructs with reject policy", () => {
    const err = new UnexpectedCommitError("codex committed", "task-7", "abc123", "reject");
    expect(err.code).toBe("UNEXPECTED_COMMIT_ERROR");
    expect(err.name).toBe("UnexpectedCommitError");
    expect(err.taskId).toBe("task-7");
    expect(err.commitSha).toBe("abc123");
    expect(err.policy).toBe("reject");
  });

  it("constructs with accept policy", () => {
    const err = new UnexpectedCommitError("codex committed", "task-8", "def456", "accept");
    expect(err.policy).toBe("accept");
  });

  it("accepts a cause", () => {
    const cause = new Error("underlying");
    const err = new UnexpectedCommitError("x", "t", "sha", "reject", cause);
    expect(err.cause).toBe(cause);
  });

  it("type guard works correctly", () => {
    const err = new UnexpectedCommitError("x", "t", "sha", "reject");
    expect(UnexpectedCommitError.is(err)).toBe(true);
    expect(UnexpectedCommitError.is(new IntegrationError("x", "c", [], "repair"))).toBe(false);
    expect(UnexpectedCommitError.is("not an error")).toBe(false);
  });

  it("inherits from ExecutionCoreError", () => {
    const err = new UnexpectedCommitError("x", "t", "sha", "accept");
    expect(err).toBeInstanceOf(ExecutionCoreError);
  });
});

// â”€â”€ Cross-cutting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("Error hierarchy cross-cutting", () => {
  it("all subclasses are instanceof ExecutionCoreError", () => {
    const errors = [
      new WorktreeError("x", "t", "create"),
      new AgentExecutionError("x", "t", 1, false, 100),
      new ScopeViolationError("x", "t", []),
      new ExecutionValidationError("x", "t", "cmd", 1, "out"),
      new IntegrationError("x", "c", [], "cherry_pick"),
      new UnexpectedCommitError("x", "t", "sha", "reject"),
    ];
    for (const err of errors) {
      expect(ExecutionCoreError.is(err)).toBe(true);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("each subclass has a unique error code", () => {
    const codes = [
      new WorktreeError("x", "t", "create").code,
      new AgentExecutionError("x", "t", 1, false, 100).code,
      new ScopeViolationError("x", "t", []).code,
      new ExecutionValidationError("x", "t", "cmd", 1, "out").code,
      new IntegrationError("x", "c", [], "cherry_pick").code,
      new UnexpectedCommitError("x", "t", "sha", "reject").code,
    ];
    expect(new Set(codes).size).toBe(6);
  });

  it("type guards are mutually exclusive for sibling classes", () => {
    const err = new WorktreeError("x", "t", "create");
    expect(WorktreeError.is(err)).toBe(true);
    expect(AgentExecutionError.is(err)).toBe(false);
    expect(ScopeViolationError.is(err)).toBe(false);
    expect(ExecutionValidationError.is(err)).toBe(false);
    expect(IntegrationError.is(err)).toBe(false);
    expect(UnexpectedCommitError.is(err)).toBe(false);
  });
});
