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
      codexOutcome: okOutcome(),
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

    const result = await recorder.record({ worktree: WORKTREE, codexOutcome: okOutcome() });

    expect(result.status).toBe("empty_diff");
    expect(result.commitSha).toBeUndefined();
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("reports scope_violation and does not commit when a file is out of scope", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: ["src/routes/tasks.ts", "secrets/key.pem"],
      diffCached: "patch"
    });
    const traceStore = new InMemoryTraceStore();
    const recorder = new ResultRecorder({ git, traceStore });

    const result = await recorder.record({
      worktree: WORKTREE,
      codexOutcome: okOutcome(),
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });

    expect(result.status).toBe("scope_violation");
    expect(result.scopeCheck.violations).toEqual(["secrets/key.pem"]);
    expect(git.opsInvoked()).not.toContain("commit");
    expect(traceStore.findByType("scope_check_failed")).toHaveLength(1);
  });

  it("reports timeout without inspecting git", async () => {
    const git = new FakeGitRunner();
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      codexOutcome: { ...okOutcome(), timedOut: true, exitCode: 124 }
    });

    expect(result.status).toBe("timeout");
    expect(git.calls).toHaveLength(0);
  });

  it("reports codex_error on a non-zero exit without inspecting git", async () => {
    const git = new FakeGitRunner();
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      codexOutcome: { ...okOutcome(), exitCode: 1 }
    });

    expect(result.status).toBe("codex_error");
    expect(result.commitSha).toBeUndefined();
    expect(git.calls).toHaveLength(0);
  });

  it("rejects an unexpected agent commit under the default reject policy", async () => {
    const git = new FakeGitRunner({ heads: { [WORKTREE.path]: "AGENT_SHA" } });
    const traceStore = new InMemoryTraceStore();
    const recorder = new ResultRecorder({ git, traceStore });

    const result = await recorder.record({ worktree: WORKTREE, codexOutcome: okOutcome() });

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
      codexOutcome: okOutcome(),
      unexpectedCommitPolicy: "accept",
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });

    expect(result.status).toBe("success");
    expect(result.commitSha).toBe("AGENT_SHA");
    expect(result.agentCommittedUnexpectedly).toBe(true);
  });
});
