import type { ExecutionValidationCommand } from "@manyhands/contracts";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import {
  IntegrationAgent,
  MockCodexCliExecutor,
  type AgentExecutionResult,
  type ValidationRunContext,
  type ValidationRunResult,
  type ValidationRunner,
  type WorktreeRecord
} from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner";

const INTEGRATION_WORKTREE: WorktreeRecord = {
  taskId: "composite-1",
  runId: "run-1",
  kind: "integration",
  path: "/repo/.manyhands/worktrees/run-1/composite-1",
  branch: "mh/run-1/composite-1",
  baseCommit: "PARENT_BASE",
  status: "active",
  createdAt: "2026-05-28T00:00:00.000Z"
};

function child(taskId: string, commitSha: string, status: AgentExecutionResult["status"] = "success"): AgentExecutionResult {
  return {
    taskId,
    status,
    baseHead: "PARENT_BASE",
    currentHead: commitSha,
    agentCommittedUnexpectedly: false,
    diff: "patch",
    changedFiles: [`src/${taskId}.ts`],
    commitSha,
    scopeCheck: { passed: true, violations: [] },
    codexExitCode: 0,
    codexDurationMs: 100,
    codexTimedOut: false
  };
}

const repair = { model: "gpt-5-codex", sandboxMode: "workspace-write" as const, timeoutMs: 600_000 };

class FakeValidationRunner implements ValidationRunner {
  constructor(private readonly result: ValidationRunResult) {}
  readonly calls: ValidationRunContext[] = [];
  async run(_commands: ExecutionValidationCommand[], ctx: ValidationRunContext): Promise<ValidationRunResult> {
    this.calls.push(ctx);
    return this.result;
  }
}

describe("IntegrationAgent", () => {
  it("cherry-picks all children cleanly and reports success", async () => {
    const git = new FakeGitRunner({ heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" } });
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      codex: new MockCodexCliExecutor(),
      traceStore,
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("success");
    expect(result.integrationCommitSha).toBe("INT_HEAD");
    expect(result.repairAttempted).toBe(false);
    expect(git.opsInvoked().filter((op) => op === "cherryPick")).toHaveLength(2);
    expect(traceStore.findByType("integration_completed")).toHaveLength(1);
  });

  it("skips integration when a child did not succeed", async () => {
    const git = new FakeGitRunner();
    const agent = new IntegrationAgent({
      git,
      codex: new MockCodexCliExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), child("b", "SHA_B", "scope_violation")],
      repair
    });

    expect(result.status).toBe("child_failed");
    expect(git.opsInvoked()).not.toContain("cherryPick");
  });

  it("repairs a conflict via Codex and reports codex_repair_success", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [
        { ok: true, conflictFiles: [], output: "" },
        { ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT" }
      ],
      diffCachedNameOnly: ["src/b.ts"],
      diffCached: "resolved patch",
      commitSha: "REPAIR_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      codex: new MockCodexCliExecutor(),
      traceStore,
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("codex_repair_success");
    expect(result.repairAttempted).toBe(true);
    expect(result.repairResult?.status).toBe("success");
    expect(git.opsInvoked()).toContain("cherryPickAbort");
    expect(traceStore.findByType("cherry_pick_conflict")).toHaveLength(1);
    expect(traceStore.findByType("codex_repair_started")).toHaveLength(1);
  });

  it("fails with codex_repair_failed when the repair leaves out-of-scope files", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["secrets/key.pem"],
      diffCached: "bad patch"
    });
    const agent = new IntegrationAgent({
      git,
      codex: new MockCodexCliExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("b", "SHA_B")],
      repair,
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });

    expect(result.status).toBe("codex_repair_failed");
    expect(result.repairResult?.status).toBe("scope_violation");
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("fails with codex_repair_failed when the repair Codex run errors", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT" }]
    });
    const agent = new IntegrationAgent({
      git,
      codex: new MockCodexCliExecutor({ defaultBehavior: { exitCode: 1 } }),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("codex_repair_failed");
    expect(result.repairResult?.status).toBe("codex_error");
    expect(git.opsInvoked()).toContain("cherryPickAbort");
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("attempts only one repair per integration: a second conflict fails fast (ADR-0025)", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [
        { ok: false, conflictFiles: ["src/a.ts"], output: "CONFLICT_A" },
        { ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT_B" }
      ],
      diffCachedNameOnly: ["src/a.ts"],
      diffCached: "resolved",
      commitSha: "REPAIR_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      codex: new MockCodexCliExecutor(),
      traceStore,
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("codex_repair_failed");
    expect(result.repairAttempted).toBe(true);
    // First conflict was repaired (one abort); the second was not retried.
    expect(git.opsInvoked().filter((op) => op === "cherryPickAbort")).toHaveLength(1);
    expect(traceStore.findByType("cherry_pick_conflict")).toHaveLength(2);
  });

  it("reports validation_failed when parent validation does not pass", async () => {
    const git = new FakeGitRunner({ heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" } });
    const validationRunner = new FakeValidationRunner({ passed: false, output: "tests failed", exitCode: 1 });
    const agent = new IntegrationAgent({
      git,
      codex: new MockCodexCliExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo",
      validationRunner
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A")],
      repair,
      parentValidationCommands: [{ command: "pnpm", args: ["test"], timeoutMs: 60_000, cwd: "worktree" }]
    });

    expect(result.status).toBe("validation_failed");
    expect(validationRunner.calls).toHaveLength(1);
  });
});
