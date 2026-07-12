import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import {
  IntegrationAgent,
  MockAgentExecutor,
  type AgentExecutionResult,
  type IntegrationOperation,
  type IntegrationOperationJournal,
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
  async open(input: Omit<IntegrationOperation, "schemaVersion" | "integrationOperationId" | "state" | "createdAt" | "updatedAt">): Promise<IntegrationOperation> {
    return this.operation ??= { ...input, schemaVersion: 1, integrationOperationId: "op-1", state: "prepared", createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" };
  }
  async update(operation: IntegrationOperation, patch: Partial<IntegrationOperation>): Promise<IntegrationOperation> {
    return this.operation = { ...operation, ...patch, updatedAt: "2026-07-12T00:00:01.000Z" };
  }
}

describe("integration operation recovery", () => {
  it("adopts a child committed before its journal transition and does not cherry-pick it twice", async () => {
    const git = new FakeGitRunner({ heads: { [worktree.path]: "FINAL" }, ancestors: ["SHA_A"] });
    const journal = new MemoryJournal();
    const result = await new IntegrationAgent({ git, executor: new MockAgentExecutor(), traceStore: new InMemoryTraceStore(), repoRoot: "/repo" }).integrate({
      compositeTaskId: "parent", attemptId: "attempt-1", worktree, childResults: [child("a", "SHA_A"), child("b", "SHA_B")],
      repair: { model: "gpt-5-codex", timeoutMs: 1 },
      integrationOperation: { journal, runId: "run-1", operationId: "operation-1", fencingToken: 7 }
    });

    expect(result.appliedCommits).toEqual([
      { childTaskId: "a", commitSha: "SHA_A", order: 0 },
      { childTaskId: "b", commitSha: "SHA_B", order: 1 }
    ]);
    expect(git.calls.filter((call) => call.op === "cherryPick").map((call) => call.args.commitSha)).toEqual(["SHA_B"]);
    expect(journal.operation?.children[0]).toMatchObject({ taskId: "a", state: "applied", resultSha: "FINAL" });
  });
});
