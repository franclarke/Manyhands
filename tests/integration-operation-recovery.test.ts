import type { ExecutionValidationCommand } from "@manyhands/contracts";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import {
  IntegrationAgent,
  MockAgentExecutor,
  type AgentExecutionResult,
  type IntegrationOperation,
  type IntegrationOperationJournal,
  type ValidationRunContext,
  type ValidationRunResult,
  type ValidationRunner,
  type WorktreeRecord
} from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner";

const worktree: WorktreeRecord = {
  taskId: "parent",
  runId: "run-1",
  kind: "integration",
  path: "/repo/worktree",
  branch: "mh/run-1/parent",
  baseCommit: "BASE",
  status: "active",
  createdAt: "2026-07-12T00:00:00.000Z"
};

function child(taskId: string, commitSha: string): AgentExecutionResult {
  return {
    taskId, status: "success", baseHead: "BASE", currentHead: commitSha,
    agentCommittedUnexpectedly: false, diff: "patch", changedFiles: [`src/${taskId}.ts`], commitSha,
    scopeCheck: { passed: true, violations: [], outOfScope: [] }, executorExitCode: 0, executorDurationMs: 1, executorTimedOut: false
  };
}

class MemoryJournal implements IntegrationOperationJournal {
  operation: IntegrationOperation | undefined;
  async open(input: Omit<IntegrationOperation, "schemaVersion" | "version" | "integrationOperationId" | "state" | "createdAt" | "updatedAt">): Promise<IntegrationOperation> {
    return this.operation ??= { ...input, schemaVersion: 2, integrationOperationId: "op-1", state: "prepared", createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" };
  }
  async update(operation: IntegrationOperation, patch: Partial<IntegrationOperation>): Promise<IntegrationOperation> {
    return this.operation = {
      ...operation,
      ...patch,
      version: (operation.version ?? 0) + 1,
      updatedAt: "2026-07-12T00:00:01.000Z"
    };
  }
}

class CountingValidationRunner implements ValidationRunner {
  calls = 0;
  constructor(private readonly result: ValidationRunResult) {}
  async run(_commands: ExecutionValidationCommand[], _ctx: ValidationRunContext): Promise<ValidationRunResult> {
    this.calls += 1;
    return this.result;
  }
}

describe("integration operation recovery", () => {
  it("adopts a child committed before its journal transition and does not cherry-pick it twice", async () => {
    const git = new FakeGitRunner({
      heads: { [worktree.path]: "FINAL" },
      ancestors: ["SHA_A"],
      cherryPickResultShas: ["PICK_B"]
    });
    const journal = new MemoryJournal();
    const result = await new IntegrationAgent({ git, executor: new MockAgentExecutor(), traceStore: new InMemoryTraceStore(), repoRoot: "/repo" }).integrate({
      compositeTaskId: "parent", attemptId: "attempt-1", worktree, childResults: [child("a", "SHA_A"), child("b", "SHA_B")],
      repair: { model: "gpt-5-codex", timeoutMs: 1 },
      integrationOperation: { journal, runId: "run-1", operationId: "operation-1", fencingToken: 7 }
    });

    expect(result.appliedCommits).toEqual([
      { childTaskId: "a", commitSha: "SHA_A", resultSha: "SHA_A", application: "already_ancestor", order: 0 },
      { childTaskId: "b", commitSha: "SHA_B", resultSha: "PICK_B", preSha: "FINAL", application: "cherry_picked", order: 1 }
    ]);
    expect(git.calls.filter((call) => call.op === "cherryPick").map((call) => call.args.commitSha)).toEqual(["SHA_B"]);
    expect(journal.operation?.children[0]).toMatchObject({ taskId: "a", state: "applied", resultSha: "SHA_A" });
  });

  it("rejects a completed schema-v1 journal whose false resultSha is only the base", async () => {
    const git = new FakeGitRunner({ heads: { [worktree.path]: "BASE" } });
    const journal = new MemoryJournal();
    journal.operation = {
      schemaVersion: 1,
      integrationOperationId: "legacy-op",
      runId: "run-1",
      parentNodeId: "parent",
      attemptId: "attempt-legacy",
      worktreePath: worktree.path,
      baseSha: "BASE",
      children: [{ taskId: "a", commitSha: "SHA_A", state: "applied", resultSha: "BASE" }],
      state: "completed",
      finalSha: "BASE",
      disposition: "success",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z"
    };

    const result = await new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    }).integrate({
      compositeTaskId: "parent",
      attemptId: "attempt-legacy",
      worktree,
      childResults: [child("a", "SHA_A")],
      repair: { model: "gpt-5-codex", timeoutMs: 1 },
      integrationOperation: { journal, runId: "run-1" }
    });

    expect(result.status).toBe("internal_error");
    expect(result.failureCode).toBe("internal_error");
    expect(result.integrationCommitSha).toBeUndefined();
    expect(journal.operation).toMatchObject({
      state: "failed",
      error: { code: "integration_recovery_invalid" }
    });
  });

  it("rejects an unexplained direct commit in the crash window instead of adopting it", async () => {
    const git = new FakeGitRunner({ heads: { [worktree.path]: "ROGUE" } });
    const journal = new MemoryJournal();
    journal.operation = {
      schemaVersion: 2,
      version: 1,
      integrationOperationId: "op-rogue",
      runId: "run-1",
      parentNodeId: "parent",
      attemptId: "00000000-0000-4000-8000-000000000003",
      operationId: "operation-1",
      fencingToken: 7,
      worktreePath: worktree.path,
      baseSha: "BASE",
      children: [{ taskId: "a", commitSha: "SHA_A", state: "started", startedFromSha: "BASE" }],
      state: "cherry_pick_started",
      currentChildId: "a",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z"
    };

    const result = await new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    }).integrate({
      compositeTaskId: "parent",
      attemptId: "00000000-0000-4000-8000-000000000003",
      worktree,
      childResults: [child("a", "SHA_A")],
      repair: { model: "gpt-5-codex", timeoutMs: 1 },
      integrationOperation: { journal, runId: "run-1", operationId: "operation-1", fencingToken: 7 }
    });

    expect(result.status).toBe("internal_error");
    expect(result.preMergeFindings).toEqual([
      expect.objectContaining({ code: "integration_recovery_invalid", message: expect.stringContaining("unexplained commit ROGUE") })
    ]);
    expect(git.calls.some((call) => call.op === "cherryPick")).toBe(false);
  });

  it("returns the exact gated receipt without rerunning parent validation or emitting duplicate traces", async () => {
    const git = new FakeGitRunner({
      heads: { [worktree.path]: "BASE" },
      cherryPickResultShas: ["PICK_A"],
      commitMessages: { PICK_A: "child\n\n(cherry picked from commit SHA_A)\n" }
    });
    const journal = new MemoryJournal();
    const validation = new CountingValidationRunner({ passed: false, output: "tests failed", exitCode: 1 });
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: "/repo",
      validationRunner: validation
    });
    const params = {
      compositeTaskId: "parent",
      attemptId: "00000000-0000-4000-8000-000000000004",
      worktree,
      childResults: [child("a", "SHA_A")],
      repair: { model: "gpt-5-codex", timeoutMs: 1 },
      parentValidationCommands: [
        { command: "pnpm", args: ["test"], timeoutMs: 1_000, cwd: "worktree" as const }
      ],
      integrationOperation: { journal, runId: "run-1", operationId: "operation-1", fencingToken: 7 }
    };

    const first = await agent.integrate(params);
    const traceCount = traceStore.list().length;
    const second = await agent.integrate(params);

    expect(first.status).toBe("validation_failed");
    expect(second).toEqual(first);
    expect(validation.calls).toBe(1);
    expect(traceStore.list()).toHaveLength(traceCount);
    expect(journal.operation?.state).toBe("gated");
  });
});
