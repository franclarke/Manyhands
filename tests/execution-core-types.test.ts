import { describe, expect, it } from "vitest";
import {
  AgentResultStatusSchema,
  WorktreeKindSchema,
  WorktreeStatusSchema,
  WorktreeRecordSchema,
  ScopeCheckResultSchema,
  ValidationRunResultSchema,
  AgentExecutionResultSchema,
  IntegrationStatusSchema,
  ConflictDetailSchema,
  IntegrationResultSchema,
  AgentExecutorOptionsSchema,
  UnexpectedCommitPolicySchema,
  ExecutionConfigSchema,
  GranularityVectorSchema,
  type AgentResultStatus,
  type WorktreeRecord,
  type AgentExecutionResult,
  type ExecutionConfig,
  type GranularityVector,
} from "@manyhands/execution-core";

// â”€â”€ Enum-like unions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("AgentResultStatusSchema", () => {
  const valid: AgentResultStatus[] = [
    "success", "empty_diff", "scope_violation", "validation_failed",
    "executor_error", "timeout", "agent_committed_unexpectedly", "internal_error",
  ];

  it.each(valid)("accepts '%s'", (status) => {
    expect(AgentResultStatusSchema.parse(status)).toBe(status);
  });

  it("rejects invalid status", () => {
    expect(() => AgentResultStatusSchema.parse("unknown")).toThrow();
  });
});

describe("WorktreeKindSchema", () => {
  it("accepts leaf and integration", () => {
    expect(WorktreeKindSchema.parse("leaf")).toBe("leaf");
    expect(WorktreeKindSchema.parse("integration")).toBe("integration");
  });

  it("rejects invalid kind", () => {
    expect(() => WorktreeKindSchema.parse("composite")).toThrow();
  });
});

describe("WorktreeStatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const s of ["pending", "active", "committed", "cleaned", "error"]) {
      expect(WorktreeStatusSchema.parse(s)).toBe(s);
    }
  });
});

describe("IntegrationStatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const s of [
      "success", "cherry_pick_conflict", "executor_repair_success",
      "executor_repair_failed", "validation_failed", "child_failed", "internal_error",
    ]) {
      expect(IntegrationStatusSchema.parse(s)).toBe(s);
    }
  });
});

describe("UnexpectedCommitPolicySchema", () => {
  it("accepts reject and accept", () => {
    expect(UnexpectedCommitPolicySchema.parse("reject")).toBe("reject");
    expect(UnexpectedCommitPolicySchema.parse("accept")).toBe("accept");
  });
});

// â”€â”€ Object schemas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("WorktreeRecordSchema", () => {
  const valid: WorktreeRecord = {
    taskId: "task-1",
    runId: "run-1",
    kind: "leaf",
    path: "/tmp/worktrees/task-1",
    branch: "mh/run-1/task-1",
    baseCommit: "abc123",
    status: "pending",
    createdAt: "2025-01-01T00:00:00.000Z",
  };

  it("parses a valid record", () => {
    const parsed = WorktreeRecordSchema.parse(valid);
    expect(parsed.taskId).toBe("task-1");
    expect(parsed.kind).toBe("leaf");
    expect(parsed.cleanedAt).toBeUndefined();
  });

  it("accepts optional cleanedAt", () => {
    const parsed = WorktreeRecordSchema.parse({ ...valid, cleanedAt: "2025-01-01T01:00:00.000Z" });
    expect(parsed.cleanedAt).toBe("2025-01-01T01:00:00.000Z");
  });

  it("rejects empty taskId", () => {
    expect(() => WorktreeRecordSchema.parse({ ...valid, taskId: "" })).toThrow();
  });
});

describe("ScopeCheckResultSchema", () => {
  it("parses with defaults", () => {
    const parsed = ScopeCheckResultSchema.parse({ passed: true });
    expect(parsed.violations).toEqual([]);
  });

  it("parses with violations", () => {
    const parsed = ScopeCheckResultSchema.parse({ passed: false, violations: ["src/forbidden.ts"] });
    expect(parsed.violations).toEqual(["src/forbidden.ts"]);
  });
});

describe("ValidationRunResultSchema", () => {
  it("parses a valid result", () => {
    const parsed = ValidationRunResultSchema.parse({ passed: true, output: "All tests passed", exitCode: 0 });
    expect(parsed.passed).toBe(true);
    expect(parsed.exitCode).toBe(0);
  });
});

describe("AgentExecutionResultSchema", () => {
  const minimal: AgentExecutionResult = {
    taskId: "task-1",
    status: "success",
    baseHead: "abc123",
    currentHead: "def456",
    agentCommittedUnexpectedly: false,
    diff: "diff --git a/src/index.ts b/src/index.ts\n...",
    changedFiles: ["src/index.ts"],
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 12000,
    executorTimedOut: false,
  };

  it("parses a minimal valid result", () => {
    const parsed = AgentExecutionResultSchema.parse(minimal);
    expect(parsed.taskId).toBe("task-1");
    expect(parsed.status).toBe("success");
    expect(parsed.commitSha).toBeUndefined();
    expect(parsed.validationResult).toBeUndefined();
    expect(parsed.tokensIn).toBeUndefined();
  });

  it("parses with all optional fields", () => {
    const full = {
      ...minimal,
      commitSha: "commit-sha-1",
      validationResult: { passed: true, output: "ok", exitCode: 0 },
      tokensIn: 1500,
      tokensOut: 800,
      costUsd: 0.05,
    };
    const parsed = AgentExecutionResultSchema.parse(full);
    expect(parsed.commitSha).toBe("commit-sha-1");
    expect(parsed.tokensIn).toBe(1500);
    expect(parsed.costUsd).toBe(0.05);
  });

  it("defaults changedFiles to empty array", () => {
    const { changedFiles: _, ...withoutChanged } = minimal;
    const parsed = AgentExecutionResultSchema.parse(withoutChanged);
    expect(parsed.changedFiles).toEqual([]);
  });
});

describe("ConflictDetailSchema", () => {
  it("parses a valid conflict", () => {
    const parsed = ConflictDetailSchema.parse({
      files: ["src/shared.ts"],
      cherryPickOutput: "CONFLICT (content): Merge conflict in src/shared.ts",
    });
    expect(parsed.files).toEqual(["src/shared.ts"]);
  });
});

describe("IntegrationResultSchema", () => {
  it("parses a success result", () => {
    const parsed = IntegrationResultSchema.parse({
      compositeTaskId: "comp-1",
      status: "success",
      childResults: [],
      repairAttempted: false,
    });
    expect(parsed.status).toBe("success");
    expect(parsed.conflictDetails).toBeUndefined();
  });
});

describe("AgentExecutorOptionsSchema", () => {
  it("parses valid options", () => {
    const parsed = AgentExecutorOptionsSchema.parse({
      cwd: "/tmp/worktrees/task-1",
      instructionFilePath: "/tmp/instructions/task-1.md",
      model: "claude-sonnet-4-5",
      timeoutMs: 300_000,
      bypassApprovals: true,
    });
    expect(parsed.env).toBeUndefined();
  });

  it("accepts optional env", () => {
    const parsed = AgentExecutorOptionsSchema.parse({
      cwd: "/tmp/wt",
      instructionFilePath: "/tmp/inst.md",
      model: "claude-sonnet-4-5",
      timeoutMs: 300_000,
      bypassApprovals: true,
      env: { ANTHROPIC_API_KEY: "sk-test" },
    });
    expect(parsed.env).toEqual({ ANTHROPIC_API_KEY: "sk-test" });
  });

  it("accepts an optional live output callback", () => {
    const onOutput = (): void => undefined;
    const parsed = AgentExecutorOptionsSchema.parse({
      cwd: "/tmp/wt",
      instructionFilePath: "/tmp/inst.md",
      model: "gemini-2.5-pro",
      timeoutMs: 300_000,
      bypassApprovals: true,
      onOutput
    });
    expect(parsed.onOutput).toBe(onOutput);
  });
});

// â”€â”€ Config with defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("ExecutionConfigSchema", () => {
  it("applies all defaults", () => {
    const parsed = ExecutionConfigSchema.parse({});
    expect(parsed.maxParallel).toBe(6);
    expect(parsed.leafTimeoutMs).toBe(300_000);
    expect(parsed.integrationTimeoutMs).toBe(600_000);
    expect(parsed.unexpectedCommitPolicy).toBe("reject");
  });

  it("allows override", () => {
    const parsed = ExecutionConfigSchema.parse({
      maxParallel: 5,
      unexpectedCommitPolicy: "accept",
    });
    expect(parsed.maxParallel).toBe(5);
    expect(parsed.unexpectedCommitPolicy).toBe("accept");
  });

  it("rejects non-positive maxParallel", () => {
    expect(() => ExecutionConfigSchema.parse({ maxParallel: 0 })).toThrow();
    expect(() => ExecutionConfigSchema.parse({ maxParallel: -1 })).toThrow();
  });
});

// â”€â”€ GranularityVector â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("GranularityVectorSchema", () => {
  const valid: GranularityVector = {
    depth: 4,
    leafCount: 6,
    compositeCount: 3,
    avgLeafDepth: 2.5,
    maxLeafDepth: 4,
    dependencyCount: 8,
    avgAcceptanceCriteriaPerLeaf: 2.3,
    integrationSuccessRate: 0.85,
    leafSuccessRate: 1.0,
    conflictRate: 0.1,
    totalDurationMs: 120_000,
    linesChanged: 450,
    unexpectedCommitCount: 0,
    scopeViolationCount: 1,
  };

  it("parses a valid vector", () => {
    const parsed = GranularityVectorSchema.parse(valid);
    expect(parsed.leafCount).toBe(6);
    expect(parsed.integrationSuccessRate).toBe(0.85);
  });

  it("accepts optional fields", () => {
    const parsed = GranularityVectorSchema.parse({
      ...valid,
      estimatedTokensPerLeaf: 2000,
      totalCostUsd: 1.5,
      testsPassedRate: 0.95,
    });
    expect(parsed.estimatedTokensPerLeaf).toBe(2000);
    expect(parsed.totalCostUsd).toBe(1.5);
    expect(parsed.testsPassedRate).toBe(0.95);
  });

  it("rejects rates outside 0-1", () => {
    expect(() => GranularityVectorSchema.parse({ ...valid, leafSuccessRate: 1.5 })).toThrow();
    expect(() => GranularityVectorSchema.parse({ ...valid, conflictRate: -0.1 })).toThrow();
  });

  it("rejects negative counts", () => {
    expect(() => GranularityVectorSchema.parse({ ...valid, leafCount: -1 })).toThrow();
  });
});
