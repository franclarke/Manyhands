import type { ExecutionValidationCommand } from "@manyhands/contracts";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import {
  IntegrationAgent,
  MockAgentExecutor,
  type AgentExecutor,
  type AgentExecutionResult,
  type AgentExecutorOptions,
  type DependencyInstaller,
  type IntegrationRepairConfig,
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
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 100,
    executorTimedOut: false
  };
}

function successfulChildWithoutCommit(taskId: string): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead: "PARENT_BASE",
    currentHead: "PARENT_BASE",
    agentCommittedUnexpectedly: false,
    diff: "patch",
    changedFiles: [`src/${taskId}.ts`],
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 100,
    executorTimedOut: false
  };
}

function noOpChild(taskId: string): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead: "PARENT_BASE",
    currentHead: "PARENT_BASE",
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [],
    noOp: true,
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 100,
    executorTimedOut: false
  };
}

const repair: IntegrationRepairConfig = { model: "gpt-5-codex", timeoutMs: 600_000 };

class FakeValidationRunner implements ValidationRunner {
  constructor(private readonly result: ValidationRunResult) {}
  readonly calls: ValidationRunContext[] = [];
  async run(_commands: ExecutionValidationCommand[], ctx: ValidationRunContext): Promise<ValidationRunResult> {
    this.calls.push(ctx);
    return this.result;
  }
}

class SequentialExecutor implements AgentExecutor {
  readonly calls: AgentExecutorOptions[] = [];
  constructor(private readonly outcomes: Array<{ exitCode: number; stdout?: string; stderr?: string }>) {}
  async execute(options: AgentExecutorOptions) {
    this.calls.push(options);
    const outcome = this.outcomes.shift() ?? { exitCode: 0 };
    return {
      exitCode: outcome.exitCode,
      stdout: outcome.stdout ?? "",
      stderr: outcome.stderr ?? "",
      timedOut: false,
      durationMs: 1
    };
  }
}

class PhysicalDiffFailureGit extends FakeGitRunner {
  override async diffRange(params: Parameters<FakeGitRunner["diffRange"]>[0]): ReturnType<FakeGitRunner["diffRange"]> {
    if (params.to === "SHA_HANDOFF") throw new Error("physical diff unavailable");
    return super.diffRange(params);
  }
}

describe("IntegrationAgent", () => {
  it("cherry-picks all children cleanly and reports success", async () => {
    const git = new FakeGitRunner({ heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" } });
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
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
    expect(result.appliedCommits).toEqual([
      { childTaskId: "a", commitSha: "SHA_A", resultSha: "INT_HEAD", preSha: "INT_HEAD", application: "cherry_picked", order: 0 },
      { childTaskId: "b", commitSha: "SHA_B", resultSha: "INT_HEAD", preSha: "INT_HEAD", application: "cherry_picked", order: 1 }
    ]);
    expect(result.omittedChildCommits).toEqual([]);
    expect(git.opsInvoked().filter((op) => op === "cherryPick")).toHaveLength(2);
    expect(traceStore.findByType("integration_completed")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "success",
          childTaskIds: ["a", "b"],
          appliedCommits: [
            { childTaskId: "a", commitSha: "SHA_A", resultSha: "INT_HEAD", preSha: "INT_HEAD", application: "cherry_picked", order: 0 },
            { childTaskId: "b", commitSha: "SHA_B", resultSha: "INT_HEAD", preSha: "INT_HEAD", application: "cherry_picked", order: 1 }
          ],
          omittedChildCommits: []
        })
      })
    ]);
  });

  it("rejects a handoff that drops an added line from a child patch", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      diffRange: "diff --git a/src/a.ts b/src/a.ts\n+export const unrelated = true;"
    });
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [{
        ...child("a", "SHA_A"),
        diff: "diff --git a/src/a.ts b/src/a.ts\n+export const required = true;",
        changedFiles: ["src/a.ts"]
      }],
      repair
    });

    expect(result.status).toBe("internal_error");
    expect(result.failureCode).toBe("internal_error");
    expect(result.integrationCommitSha).toBeUndefined();
    expect(result.preMergeFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "handoff_intent_not_retained" })
    ]));
  });

  it("skips a no-op child (deliverable already in the base) and integrates the rest", async () => {
    const git = new FakeGitRunner({ heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" } });
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), noOpChild("barrel")],
      repair
    });

    expect(result.status).toBe("success");
    expect(result.appliedCommits).toEqual([
      { childTaskId: "a", commitSha: "SHA_A", resultSha: "INT_HEAD", preSha: "INT_HEAD", application: "cherry_picked", order: 0 }
    ]);
    expect(result.omittedChildCommits).toEqual([]);
    // The no-op child contributes nothing: only the real child is cherry-picked.
    expect(git.opsInvoked().filter((op) => op === "cherryPick")).toHaveLength(1);
  });

  it("skips integration when a child did not succeed", async () => {
    const git = new FakeGitRunner();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
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
    expect(result.failureCode).toBe("child_failed");
    expect(result.omittedChildCommits).toEqual([
      { childTaskId: "b", reason: "child_failed", status: "scope_violation", commitSha: "SHA_B" }
    ]);
    expect(git.opsInvoked()).not.toContain("cherryPick");
  });

  it("fails explicitly when a successful child has no commit", async () => {
    const git = new FakeGitRunner();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), successfulChildWithoutCommit("b")],
      repair
    });

    expect(result.status).toBe("child_failed");
    expect(result.failureCode).toBe("missing_child_commit");
    expect(result.omittedChildCommits).toEqual([
      { childTaskId: "b", reason: "missing_child_commit", status: "success" }
    ]);
    expect(result.preMergeFindings).toEqual([
      expect.objectContaining({
        code: "missing_child_commit",
        message: expect.stringContaining("b")
      })
    ]);
    expect(git.opsInvoked()).not.toContain("cherryPick");
  });

  it("fails explicitly before cherry-pick when a child commit is not reachable", async () => {
    const git = new FakeGitRunner({ missingRefs: ["BAD_SHA"] });
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "BAD_SHA")],
      repair
    });

    expect(result.status).toBe("child_failed");
    expect(result.failureCode).toBe("invalid_child_commit");
    expect(result.preMergeFindings).toEqual([
      expect.objectContaining({
        code: "invalid_child_commit",
        message: expect.stringContaining("BAD_SHA")
      })
    ]);
    expect(result.omittedChildCommits).toEqual([
      { childTaskId: "a", reason: "invalid_child_commit", status: "success", commitSha: "BAD_SHA" }
    ]);
    expect(git.opsInvoked()).toContain("revParse");
    expect(git.opsInvoked()).not.toContain("cherryPick");
  });

  it("fails explicitly before cherry-pick when successful children report the same commit", async () => {
    const git = new FakeGitRunner();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "DUP_SHA"), child("b", "DUP_SHA")],
      repair
    });

    expect(result.status).toBe("child_failed");
    expect(result.failureCode).toBe("invalid_child_commit");
    expect(result.preMergeFindings).toEqual([
      expect.objectContaining({
        code: "duplicate_child_commit",
        message: expect.stringContaining("already reported by a")
      })
    ]);
    expect(result.omittedChildCommits).toEqual([
      { childTaskId: "b", reason: "invalid_child_commit", status: "success", commitSha: "DUP_SHA" }
    ]);
    expect(git.opsInvoked()).not.toContain("cherryPick");
  });

  it("repairs a conflict via Codex and reports executor_repair_success", async () => {
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
      executor: new MockAgentExecutor({
        defaultBehavior: {
          stdout: "repair thinking\n",
          stderr: "repair warning\n"
        }
      }),
      traceStore,
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("executor_repair_success");
    expect(result.repairAttempted).toBe(true);
    expect(result.repairResult?.status).toBe("success");
    expect(result.appliedCommits).toEqual([
      { childTaskId: "a", commitSha: "SHA_A", resultSha: "INT_HEAD", preSha: "INT_HEAD", application: "cherry_picked", order: 0 },
      { childTaskId: "b", commitSha: "SHA_B", resultSha: "REPAIR_SHA", preSha: "INT_HEAD", application: "repaired", order: 1 }
    ]);
    expect(result.repairAttempts).toEqual([
      { childTaskId: "b", pass: 1, status: "started", files: ["src/b.ts"] },
      { childTaskId: "b", pass: 1, status: "committed", files: ["src/b.ts"] }
    ]);
    expect(git.opsInvoked()).toContain("cherryPickAbort");
    expect(traceStore.findByType("cherry_pick_conflict")).toHaveLength(1);
    expect(traceStore.findByType("executor_repair_started")).toHaveLength(1);
    expect(traceStore.findByType("executor_output")).toEqual([
      expect.objectContaining({
        actor: "agent",
        taskId: "composite-1",
        payload: { stream: "stdout", chunk: "repair thinking\n", repairChildTaskId: "b" }
      }),
      expect.objectContaining({
        actor: "agent",
        taskId: "composite-1",
        payload: { stream: "stderr", chunk: "repair warning\n", repairChildTaskId: "b" }
      })
    ]);
  });

  it("repair prompt carries parent goal, canonical seams, and child intent (Artifact 2)", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/parser.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/parser.ts"],
      diffCached: "resolved patch",
      commitSha: "REPAIR_SHA"
    });
    const prompts: string[] = [];
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo",
      writeInstructions: async (_path, content) => {
        prompts.push(content);
      }
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("parse", "SHA_PARSE")],
      repair,
      parentGoal: "Evaluate arithmetic expression strings",
      sharedInterfaces: [
        {
          id: "Ast",
          kind: "type",
          signature: "type Ast = number | { op: string; args: Ast[] }",
          description: "parsed expression tree",
          definedAtNodeId: "root"
        }
      ],
      childIntents: [
        { taskId: "parse", goal: "Build an AST from tokens", consumes: ["Token"], produces: ["Ast"] }
      ]
    });

    expect(result.status).toBe("executor_repair_success");
    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("Evaluate arithmetic expression strings");
    expect(prompt).toContain("type Ast = number");
    expect(prompt).toContain("Build an AST from tokens");
    expect(prompt).toContain("It produces: Ast.");
  });

  it("hydrates a synthetic composite handoff prompt from the physical first-parent Git diff", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      mergeParents: { SHA_HANDOFF: ["PARENT_BASE", "LINEAGE"] },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/composed.ts"], output: "CONFLICT" }],
      diffRangeNameOnly: ["src/composed.ts"],
      diffRange: "diff --git a/src/composed.ts b/src/composed.ts\n+export const composed = true;",
      diffCachedNameOnly: ["src/composed.ts"],
      diffCached: "resolved patch",
      commitSha: "REPAIR_SHA"
    });
    const prompts: string[] = [];
    const synthetic = {
      ...child("nested-composite", "SHA_HANDOFF"),
      diff: "",
      changedFiles: [],
      cherryPickMainline: 1 as const
    };
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo",
      writeInstructions: async (_path, content) => {
        prompts.push(content);
      }
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [synthetic],
      repair
    });

    expect(result.status).toBe("executor_repair_success");
    expect(prompts[0]).toContain("Incoming child patch (Git source of truth):");
    expect(prompts[0]).toContain("Changed files: src/composed.ts");
    expect(prompts[0]).toContain("+export const composed = true;");
  });

  it("fails closed when a synthetic child diff cannot be materialized", async () => {
    const git = new PhysicalDiffFailureGit({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      mergeParents: { SHA_HANDOFF: ["PARENT_BASE", "LINEAGE"] },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/composed.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/composed.ts"],
      diffCached: "resolved patch",
      commitSha: "REPAIR_SHA"
    });
    const executor = new MockAgentExecutor();
    const synthetic = {
      ...child("nested-composite", "SHA_HANDOFF"),
      diff: "",
      changedFiles: [],
      cherryPickMainline: 1 as const
    };
    const agent = new IntegrationAgent({
      git,
      executor,
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [synthetic],
      repair
    });

    expect(result.status).toBe("internal_error");
    expect(result.failureCode).toBe("internal_error");
    expect(executor.calls).toHaveLength(0);
  });

  it("repair prompt surfaces predicted conflicts that overlap the colliding files (Pieza 2)", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/parser.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/parser.ts"],
      diffCached: "resolved patch",
      commitSha: "REPAIR_SHA"
    });
    const prompts: string[] = [];
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo",
      writeInstructions: async (_path, content) => {
        prompts.push(content);
      }
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("parse", "SHA_PARSE")],
      repair,
      predictedConflicts: [
        {
          taskAId: "parse",
          taskBId: "eval",
          level: "high",
          sharedFiles: ["src/parser.ts"],
          sharedSymbols: ["Ast"],
          explanation: "Both edit the parser and share the Ast type"
        },
        {
          taskAId: "x",
          taskBId: "y",
          level: "medium",
          sharedFiles: ["src/unrelated.ts"],
          sharedSymbols: [],
          explanation: "Unrelated overlap"
        }
      ]
    });

    expect(result.status).toBe("executor_repair_success");
    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("Both edit the parser and share the Ast type");
    expect(prompt).toContain("Ast");
    // The non-overlapping prediction must NOT leak into this conflict's prompt.
    expect(prompt).not.toContain("Unrelated overlap");
  });

  it("fails with executor_repair_failed when the repair touches a forbidden path", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["secrets/key.pem"],
      diffCached: "bad patch"
    });
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("b", "SHA_B")],
      repair,
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] },
      forbiddenPaths: ["secrets/**"]
    });

    expect(result.status).toBe("executor_repair_failed");
    expect(result.repairResult?.status).toBe("scope_violation");
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("fails with executor_repair_failed when the repair Codex run errors", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT" }]
    });
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor({ defaultBehavior: { exitCode: 1 } }),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("executor_repair_failed");
    expect(result.failureCode).toBe("repair_failed");
    expect(result.repairResult?.status).toBe("executor_error");
    expect(result.omittedChildCommits).toEqual([
      { childTaskId: "b", reason: "repair_failed", status: "success", commitSha: "SHA_B" }
    ]);
    expect(git.opsInvoked()).toContain("cherryPickAbort");
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("fails a cherry-pick conflict explicitly and aborts when repair is disabled", async () => {
    const git = new FakeGitRunner({
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/a.ts"], output: "CONFLICT" }]
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), child("b", "SHA_B")],
      repair: { ...repair, maxRepairsPerIntegration: 0 }
    });

    expect(result.status).toBe("executor_repair_failed");
    expect(result.failureCode).toBe("cherry_pick_conflict");
    expect(result.conflictDetails?.files).toEqual(["src/a.ts"]);
    expect(result.appliedCommits).toEqual([]);
    expect(result.omittedChildCommits).toEqual([
      { childTaskId: "a", reason: "cherry_pick_conflict", status: "success", commitSha: "SHA_A" },
      { childTaskId: "b", reason: "cherry_pick_conflict", status: "success", commitSha: "SHA_B" }
    ]);
    expect(git.opsInvoked()).toContain("cherryPickAbort");
    expect(traceStore.findByType("integration_completed")[0]?.payload).toMatchObject({
      failureCode: "cherry_pick_conflict",
      omittedChildCommits: result.omittedChildCommits
    });
  });

  it("repairs multiple conflicting children within the integration repair budget", async () => {
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
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("executor_repair_success");
    expect(result.repairAttempted).toBe(true);
    expect(result.integrationCommitSha).toBe("REPAIR_SHA");
    expect(git.opsInvoked().filter((op) => op === "cherryPickAbort")).toHaveLength(2);
    expect(git.opsInvoked().filter((op) => op === "commit")).toHaveLength(2);
    expect(traceStore.findByType("cherry_pick_conflict")).toHaveLength(2);
    expect(traceStore.findByType("executor_repair_started")).toHaveLength(2);
  });

  it("preserves the partial integration commit when a later repair fails", async () => {
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
      executor: new SequentialExecutor([{ exitCode: 0 }, { exitCode: 1, stderr: "repair failed" }]),
      traceStore,
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("executor_repair_failed");
    expect(result.failureCode).toBe("repair_failed");
    expect(result.repairAttempted).toBe(true);
    expect(result.repairResult?.status).toBe("executor_error");
    expect(result.integrationCommitSha).toBe("REPAIR_SHA");
    expect(git.opsInvoked().filter((op) => op === "cherryPickAbort")).toHaveLength(2);
    expect(traceStore.findByType("cherry_pick_conflict")).toHaveLength(2);
  });

  it("fails after the configured max repairs per integration and preserves the partial commit", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [
        { ok: false, conflictFiles: ["src/a.ts"], output: "CONFLICT_A" },
        { ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT_B" },
        { ok: false, conflictFiles: ["src/c.ts"], output: "CONFLICT_C" }
      ],
      diffCachedNameOnly: ["src/a.ts"],
      diffCached: "resolved",
      commitSha: "REPAIR_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A"), child("b", "SHA_B"), child("c", "SHA_C")],
      repair: { ...repair, maxRepairsPerIntegration: 2 }
    });

    expect(result.status).toBe("executor_repair_failed");
    expect(result.failureCode).toBe("cherry_pick_conflict");
    expect(result.repairAttempted).toBe(true);
    expect(result.integrationCommitSha).toBe("REPAIR_SHA");
    expect(git.opsInvoked().filter((op) => op === "commit")).toHaveLength(2);
    expect(git.opsInvoked().filter((op) => op === "cherryPickAbort")).toHaveLength(3);
    expect(traceStore.findByType("cherry_pick_conflict")).toHaveLength(3);
  });

  it("re-prompts with compiler feedback when the repair is syntactically malformed, then succeeds (AST gate)", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/b.ts"],
      diffCached: "resolved patch",
      commitSha: "REPAIR_SHA"
    });
    const prompts: string[] = [];
    const syntaxResults = [
      { passed: false, findings: [{ file: "src/b.ts:3:1", message: "'}' expected." }] },
      { passed: true, findings: [] }
    ];
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: "/repo",
      writeInstructions: async (_path, content) => {
        prompts.push(content);
      },
      checkSyntax: async () => syntaxResults.shift() ?? { passed: true, findings: [] }
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("executor_repair_success");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("syntactically invalid");
    expect(prompts[1]).toContain("syntactically invalid");
    expect(prompts[1]).toContain("'}' expected.");
    expect(traceStore.findByType("repair_syntax_rejected")).toHaveLength(1);
    expect(traceStore.findByType("executor_repair_started")).toHaveLength(2);
  });

  it("fails the repair when both passes produce malformed code", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/b.ts"],
      diffCached: "still broken",
      commitSha: "REPAIR_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: "/repo",
      checkSyntax: async () => ({
        passed: false,
        findings: [{ file: "src/b.ts", message: "unresolved git conflict markers (<<<<<<< / ======= / >>>>>>>) remain" }]
      })
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("executor_repair_failed");
    expect(result.failureCode).toBe("repair_failed");
    expect(result.repairResult?.status).toBe("validation_failed");
    expect(traceStore.findByType("repair_syntax_rejected")).toHaveLength(2);
    // Malformed code is never committed.
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("treats a repair that stages no changes as a failed repair, never committing an empty index (F-013)", async () => {
    // The repair executor succeeds but stages nothing (diffCachedNameOnly: []),
    // so the cherry-pick conflict is unresolved. Real git refuses to commit an
    // empty index and throws, which used to crash the whole integration. The
    // repair must fail cleanly and must NOT attempt the commit.
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: [],
      diffCached: ""
    });
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("executor_repair_failed");
    expect(result.repairResult?.status).toBe("validation_failed");
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("does not throw when real git rejects an empty repair commit (F-013 crash guard)", async () => {
    // Models real git: commit on an empty index throws. With the empty-changes
    // guard the commit is never reached, so integrate() returns a clean failure
    // instead of rejecting with an unhandled exception.
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/b.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: [],
      diffCached: "",
      failOperations: { commit: new Error("nothing to commit, working tree clean") }
    });
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo"
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("b", "SHA_B")],
      repair
    });

    expect(result.status).toBe("executor_repair_failed");
  });

  it("reports validation_failed when parent validation does not pass", async () => {
    const git = new FakeGitRunner({ heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" } });
    const validationRunner = new FakeValidationRunner({ passed: false, output: "tests failed", exitCode: 1 });
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
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
    expect(result.failureCode).toBe("validation_failed");
    expect(result.validationWorktreePath).toBe(INTEGRATION_WORKTREE.path);
    expect(validationRunner.calls).toHaveLength(1);
    expect(validationRunner.calls[0]).toEqual({
      worktreePath: INTEGRATION_WORKTREE.path,
      repoRoot: "/repo",
      supervision: { runId: "run-1" }
    });
  });

  it("installs dependencies before running parent validation", async () => {
    // Fix 4: parent validation runs against the freshly-composed integration
    // worktree, which for a greenfield project has a package.json but no
    // node_modules. Install once, before validation, so build/typecheck resolve.
    const git = new FakeGitRunner({ heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" } });
    const order: string[] = [];
    const installedIn: string[] = [];
    const dependencyInstaller: DependencyInstaller = {
      ensure: async ({ cwd }) => {
        installedIn.push(cwd);
        order.push("install");
        return { installed: true, packageManager: "npm" };
      }
    };
    const validationRunner: ValidationRunner = {
      run: async (): Promise<ValidationRunResult> => {
        order.push("validate");
        return { passed: true, output: "", exitCode: 0 };
      }
    };
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo",
      validationRunner,
      dependencyInstaller
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A")],
      repair,
      parentValidationCommands: [{ command: "npm", args: ["run", "build"], timeoutMs: 60_000, cwd: "worktree" }]
    });

    expect(result.status).toBe("success");
    expect(installedIn).toEqual([INTEGRATION_WORKTREE.path]);
    expect(order).toEqual(["install", "validate"]);
  });

  it("does not let a successful repair hide a failing parent validation", async () => {
    const git = new FakeGitRunner({
      heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" },
      cherryPickOutcomes: [{ ok: false, conflictFiles: ["src/a.ts"], output: "CONFLICT" }],
      diffCachedNameOnly: ["src/a.ts"],
      diffCached: "resolved patch",
      commitSha: "REPAIR_SHA"
    });
    const validationRunner = new FakeValidationRunner({ passed: false, output: "tests failed", exitCode: 1 });
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
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
    expect(result.failureCode).toBe("validation_failed");
    expect(result.repairAttempted).toBe(true);
    expect(result.repairResult?.status).toBe("success");
    expect(result.appliedCommits).toEqual([
      { childTaskId: "a", commitSha: "SHA_A", resultSha: "REPAIR_SHA", preSha: "INT_HEAD", application: "repaired", order: 0 }
    ]);
    expect(result.parentValidation).toEqual({ passed: false, output: "tests failed", exitCode: 1 });
    expect(result.validationWorktreePath).toBe(INTEGRATION_WORKTREE.path);
  });

  it('defers parent validation when the integrated workspace has no "test" script', async () => {
    const git = new FakeGitRunner({ heads: { [INTEGRATION_WORKTREE.path]: "INT_HEAD" } });
    const traceStore = new InMemoryTraceStore();
    const validationRunner = new FakeValidationRunner({
      passed: false,
      output:
        'npm error Missing script: "test"\n' +
        "npm error\n" +
        "npm error To see a list of scripts, run:\n" +
        "npm error   npm run",
      exitCode: 1
    });
    const agent = new IntegrationAgent({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: "/repo",
      validationRunner
    });

    const result = await agent.integrate({
      compositeTaskId: "composite-1",
      worktree: INTEGRATION_WORKTREE,
      childResults: [child("a", "SHA_A")],
      repair,
      parentValidationCommands: [{ command: "npm", args: ["run", "test"], timeoutMs: 60_000, cwd: "worktree" }]
    });

    expect(result.status).toBe("success");
    expect(result.parentValidation).toEqual({
      passed: true,
      output:
        'npm error Missing script: "test"\n' +
        "npm error\n" +
        "npm error To see a list of scripts, run:\n" +
        "npm error   npm run",
      exitCode: 1
    });
    expect(traceStore.findByType("validation_deferred")).toHaveLength(1);
    expect(traceStore.findByType("validation_deferred")[0]?.payload).toMatchObject({
      scope: "parent",
      exitCode: 1,
      reason: "missing_test_script"
    });
  });
});
