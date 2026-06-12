import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import { ResultRecorder, type WorktreeRecord } from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner";

const WORKTREE: WorktreeRecord = {
  taskId: "task-1",
  runId: "run-1",
  kind: "leaf",
  path: "/repo/.manyhands/worktrees/run-1/task-1",
  branch: "mh/run-1/task-1",
  baseCommit: "BASE_SHA",
  status: "active",
  createdAt: "2026-05-28T00:00:00.000Z"
};

function okOutcome() {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1000 };
}

describe("ResultRecorder usage and failure diagnosis", () => {
  it("upgrades usageSource to reported when the executor outcome carries real usage", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: ["src/a.ts"],
      diffCached: "patch",
      commitSha: "SHA"
    });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: { ...okOutcome(), tokensIn: 120, tokensOut: 30, costUsd: 0.02 },
      usageSource: "unavailable"
    });

    expect(result.usageSource).toBe("reported");
    expect(result.tokensIn).toBe(120);
  });

  it("keeps the declared usageSource when the outcome reports nothing", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: ["src/a.ts"],
      diffCached: "patch",
      commitSha: "SHA"
    });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      usageSource: "unavailable"
    });

    expect(result.usageSource).toBe("unavailable");
  });

  it("attaches a failure diagnosis when the executor fails with a recognizable cause", async () => {
    const git = new FakeGitRunner({ heads: { [WORKTREE.path]: "BASE_SHA" }, diffCachedNameOnly: [] });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: {
        exitCode: 1,
        stdout: "",
        stderr: "429 RESOURCE_EXHAUSTED: quota exceeded",
        timedOut: false,
        durationMs: 50
      }
    });

    expect(result.status).toBe("executor_error");
    expect(result.failureKind).toBe("quota");
    expect(result.failureHint).toMatch(/executor|quota|model/i);
  });
});

describe("ResultRecorder artifact hygiene", () => {
  it("stages with the artifact exclude globs, never a bare add -A", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: ["src/a.ts"],
      diffCached: "patch",
      commitSha: "SHA"
    });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    await recorder.record({ worktree: WORKTREE, executorOutcome: okOutcome() });

    const staging = git.calls.find((call) => call.op === "addAllExcluding");
    expect(staging).toBeDefined();
    expect(staging?.args.excludeGlobs).toContain("**/node_modules/**");
    expect(git.opsInvoked()).not.toContain("addAll");
  });

  it("logs an oversized-change advisory above the threshold without failing the leaf", async () => {
    const manyFiles = Array.from({ length: 501 }, (_, i) => `src/file-${i}.ts`);
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: manyFiles,
      diffCached: "patch",
      commitSha: "SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const recorder = new ResultRecorder({ git, traceStore });

    const result = await recorder.record({ worktree: WORKTREE, executorOutcome: okOutcome() });

    expect(result.status).toBe("success");
    const advisory = traceStore
      .list()
      .find((event) => event.type === "scope_advisory" && event.payload.reason === "oversized_change");
    expect(advisory).toBeDefined();
    expect(advisory?.payload.changedFiles).toBe(501);
  });

  it("stays silent below the threshold", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: ["src/a.ts"],
      diffCached: "patch",
      commitSha: "SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const recorder = new ResultRecorder({ git, traceStore });

    await recorder.record({ worktree: WORKTREE, executorOutcome: okOutcome() });

    expect(
      traceStore.list().some((event) => event.type === "scope_advisory" && event.payload.reason === "oversized_change")
    ).toBe(false);
  });
});

describe("ResultRecorder", () => {
  it("commits and reports success when changes are in scope", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: ["src/routes/tasks.ts"],
      diffCached: "diff --git a/src/routes/tasks.ts b/src/routes/tasks.ts",
      commitSha: "NEW_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const recorder = new ResultRecorder({ git, traceStore });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });

    expect(result.status).toBe("success");
    expect(result.commitSha).toBe("NEW_SHA");
    expect(result.currentHead).toBe("NEW_SHA");
    expect(result.changedFiles).toEqual(["src/routes/tasks.ts"]);
    expect(git.opsInvoked()).toContain("commit");
    expect(traceStore.findByType("agent_committed")).toHaveLength(1);
  });

  it("reports empty_diff and does not commit when nothing changed", async () => {
    const git = new FakeGitRunner({ heads: { [WORKTREE.path]: "BASE_SHA" }, diffCachedNameOnly: [] });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({ worktree: WORKTREE, executorOutcome: okOutcome() });

    expect(result.status).toBe("empty_diff");
    expect(result.commitSha).toBeUndefined();
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("reports scope_violation and does not commit when a file hits a forbidden path", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: ["src/routes/tasks.ts", "secrets/key.pem"],
      diffCached: "patch"
    });
    const traceStore = new InMemoryTraceStore();
    const recorder = new ResultRecorder({ git, traceStore });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] },
      forbiddenPaths: ["secrets/**"]
    });

    expect(result.status).toBe("scope_violation");
    expect(result.scopeCheck.violations).toEqual(["secrets/key.pem"]);
    expect(git.opsInvoked()).not.toContain("commit");
    expect(traceStore.findByType("scope_check_failed")).toHaveLength(1);
  });

  it("commits and succeeds when an out-of-allow-list file is only advisory (not forbidden)", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: ["src/routes/tasks.ts", "index.html"],
      diffCached: "patch",
      commitSha: "LEAF_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const recorder = new ResultRecorder({ git, traceStore });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });

    // The allow-list is advisory: an out-of-lane file is recorded but the leaf
    // still commits and succeeds, so one guessed glob can't fail the run.
    expect(result.status).toBe("success");
    expect(result.scopeCheck.violations).toEqual([]);
    expect(result.scopeCheck.outOfScope).toEqual(["index.html"]);
    expect(git.opsInvoked()).toContain("commit");
    expect(traceStore.findByType("scope_check_failed")).toHaveLength(0);
    expect(traceStore.findByType("scope_advisory")).toHaveLength(1);
  });

  it("reports timeout without inspecting git", async () => {
    const git = new FakeGitRunner();
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: { ...okOutcome(), timedOut: true, exitCode: 124 }
    });

    expect(result.status).toBe("timeout");
    expect(git.calls).toHaveLength(0);
  });

  it("reports executor_error on a non-zero exit without inspecting git", async () => {
    const git = new FakeGitRunner();
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: { ...okOutcome(), exitCode: 1 }
    });

    expect(result.status).toBe("executor_error");
    expect(result.commitSha).toBeUndefined();
    expect(git.calls).toHaveLength(0);
  });

  it("preserves the executor stderr/stdout tails as the actionable cause on failure", async () => {
    const git = new FakeGitRunner();
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: {
        ...okOutcome(),
        exitCode: 1,
        stderr: "Error: Quota exceeded for quota metric 'GenerateContent requests'.",
        stdout: "starting gemini..."
      }
    });

    expect(result.status).toBe("executor_error");
    expect(result.stderrTail).toContain("Quota exceeded");
    expect(result.stdoutTail).toBe("starting gemini...");
    expect(result.executorExitCode).toBe(1);
  });

  it("rejects an unexpected agent commit under the default reject policy", async () => {
    const git = new FakeGitRunner({ heads: { [WORKTREE.path]: "AGENT_SHA" } });
    const traceStore = new InMemoryTraceStore();
    const recorder = new ResultRecorder({ git, traceStore });

    const result = await recorder.record({ worktree: WORKTREE, executorOutcome: okOutcome() });

    expect(result.status).toBe("agent_committed_unexpectedly");
    expect(result.agentCommittedUnexpectedly).toBe(true);
    expect(result.currentHead).toBe("AGENT_SHA");
    expect(git.opsInvoked()).not.toContain("commit");
    expect(traceStore.findByType("unexpected_commit_detected")).toHaveLength(1);
  });

  it("accepts an unexpected agent commit under the accept policy when in scope", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "AGENT_SHA" },
      diffRangeNameOnly: ["src/routes/tasks.ts"],
      diffRange: "patch"
    });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      unexpectedCommitPolicy: "accept",
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });

    expect(result.status).toBe("success");
    expect(result.commitSha).toBe("AGENT_SHA");
    expect(result.agentCommittedUnexpectedly).toBe(true);
  });
});
