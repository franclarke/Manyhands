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

describe("ResultRecorder empty-diff no-op handling", () => {
  /**
   * The SP2 rehearsal of 2026-08-07, reduced. A leaf was told to add order
   * priority to `src/domain/orders.mjs`; its executor spent 184k tokens and
   * changed nothing. The recorder answered `success / already_satisfied`, the
   * artifact was adopted at the base commit, and the run only broke two nodes
   * later with `artifact_empty` — classified `unclassified`, because by then
   * nothing could name the cause.
   *
   * The no-op branch exists for a file the run's own grounding scaffolder wrote
   * complete, leaving its leaf nothing to add. Its test was "the file exists and
   * carries no stub marker", which every pre-existing file in a real repository
   * passes. So on any brownfield target the branch fires for any leaf that
   * touches a file that was already there — that is, always.
   *
   * A no-op needs positive evidence that this run produced the baseline. Absent
   * it, an agent that did nothing is not distinguishable from an agent that had
   * nothing to do, and the run must not claim it was.
   */
  it("keeps an empty diff a failure over a file this run never scaffolded", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: [],
      // A complete, pre-existing implementation. No stub marker, because no
      // scaffolder ever touched it — it shipped with the target.
      showFile: { "src/domain/orders.mjs": "export function placeOrder(state, order) {\n  return state;\n}\n" }
    });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      executionScope: { implementationPaths: ["src/domain/orders.mjs"], testPaths: [], configPaths: [] },
      expectedOutput: { changedFiles: ["src/domain/orders.mjs"], producedSymbols: [], consumedSymbols: [], diffShapeHint: "diff" }
    });

    expect(result.status).toBe("empty_diff");
    expect(result.disposition).toBe("failed");
    expect(result.noOp).toBeUndefined();
  });

  it("treats an empty diff as a no-op success when the baseline already satisfies the contract", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: [],
      showFile: { "src/index.js": "export { slugify } from './slugify.js';\n" }
    });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      executionScope: { implementationPaths: ["src/index.js"], testPaths: [], configPaths: [] },
      expectedOutput: { changedFiles: ["src/index.js"], producedSymbols: [], consumedSymbols: [], diffShapeHint: "diff" },
      // The premise the branch was always assuming, now stated: this run wrote
      // the file, so "complete and unmodified" really does mean the leaf had
      // nothing to add. Leaving it implicit is what made the branch fire for
      // every pre-existing file in a real repository.
      groundingScaffoldedPaths: ["src/index.js"]
    });

    expect(result.status).toBe("success");
    expect(result.noOp).toBe(true);
    expect(result.disposition).toBe("already_satisfied");
    expect(result.baselineEvidence?.verifiedPaths).toEqual(["src/index.js"]);
    expect(result.changedFiles).toEqual([]);
    expect(result.commitSha).toBeUndefined();
  });

  it("rejects an empty diff when only one of several concrete outputs exists", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" }, diffCachedNameOnly: [],
      showFile: { "src/a.ts": "export const a = 1;", "src/b.ts": null }
    });
    const result = await new ResultRecorder({ git, traceStore: new InMemoryTraceStore() }).record({
      worktree: WORKTREE, executorOutcome: okOutcome(),
      expectedOutput: { changedFiles: ["src/a.ts", "src/b.ts"], producedSymbols: [], consumedSymbols: [], diffShapeHint: "diff" }
    });
    expect(result.status).toBe("empty_diff");
    expect(result.disposition).toBe("failed");
  });

  it("rejects an abstract empty-diff contract without explicit validation evidence", async () => {
    const git = new FakeGitRunner({ heads: { [WORKTREE.path]: "BASE_SHA" }, diffCachedNameOnly: [] });
    const result = await new ResultRecorder({ git, traceStore: new InMemoryTraceStore() }).record({
      worktree: WORKTREE, executorOutcome: okOutcome(),
      expectedOutput: { changedFiles: [], producedSymbols: ["PublicApi"], consumedSymbols: [], diffShapeHint: "abstract" }
    });
    expect(result.status).toBe("empty_diff");
    expect(result.disposition).toBe("failed");
  });

  it("keeps an empty diff a failure when an implementation file is still an unimplemented stub", async () => {
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: [],
      showFile: { "src/slugify.js": "export function slugify(input) {\n  throw new Error('Not implemented');\n}\n" }
    });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      executionScope: { implementationPaths: ["src/slugify.js"], testPaths: [], configPaths: [] }
    });

    expect(result.status).toBe("empty_diff");
    expect(result.noOp).toBeUndefined();
  });

  it("keeps an empty diff a failure when no execution scope identifies the deliverable", async () => {
    const git = new FakeGitRunner({ heads: { [WORKTREE.path]: "BASE_SHA" }, diffCachedNameOnly: [] });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({ worktree: WORKTREE, executorOutcome: okOutcome() });

    expect(result.status).toBe("empty_diff");
  });
});

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
      scopePolicy: "advisory",
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });

    // Under the explicit advisory policy an out-of-lane file is recorded but the
    // leaf still commits and succeeds, so one guessed glob can't fail the run.
    expect(result.status).toBe("success");
    expect(result.scopeCheck.violations).toEqual([]);
    expect(result.scopeCheck.outOfScope).toEqual(["index.html"]);
    expect(git.opsInvoked()).toContain("commit");
    expect(traceStore.findByType("scope_check_failed")).toHaveLength(0);
    expect(traceStore.findByType("scope_advisory")).toHaveLength(1);
  });

  it("defaults to strict: discards an out-of-allow-list write when no policy is configured", async () => {
    // A16 / 02-contracts: the scope is an adoption boundary. With no explicit
    // policy the safe default must discard the candidate, not silently commit it.
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "BASE_SHA" },
      diffCachedNameOnly: ["src/routes/tasks.ts", "index.html"],
      diffCached: "patch",
      commitSha: "LEAF_SHA"
    });
    const result = await new ResultRecorder({ git, traceStore: new InMemoryTraceStore() }).record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });
    expect(result.status).toBe("scope_violation");
    expect(result.disposition).toBe("failed");
    expect(result.scopeCheck.outOfScope).toEqual(["index.html"]);
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it.each([
    ["gate", "scope_gated", "gated", false],
    ["strict", "scope_violation", "failed", false]
  ] as const)("applies %s scope policy in the runtime", async (scopePolicy, status, disposition, commits) => {
    const git = new FakeGitRunner({ heads: { [WORKTREE.path]: "BASE_SHA" }, diffCachedNameOnly: ["outside.ts"], diffCached: "patch", commitSha: "SHA" });
    const result = await new ResultRecorder({ git, traceStore: new InMemoryTraceStore() }).record({
      worktree: WORKTREE, executorOutcome: okOutcome(), scopePolicy,
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });
    expect(result.status).toBe(status);
    expect(result.disposition).toBe(disposition);
    expect(git.opsInvoked().includes("commit")).toBe(commits);
  });

  it.each(["advisory", "gate", "strict"] as const)("keeps forbidden paths as hard deny under %s", async (scopePolicy) => {
    const git = new FakeGitRunner({ heads: { [WORKTREE.path]: "BASE_SHA" }, diffCachedNameOnly: ["secret.env"], diffCached: "patch" });
    const result = await new ResultRecorder({ git, traceStore: new InMemoryTraceStore() }).record({
      worktree: WORKTREE, executorOutcome: okOutcome(), scopePolicy, forbiddenPaths: ["*.env"]
    });
    expect(result.status).toBe("scope_violation");
    expect(result.disposition).toBe("failed");
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

  it("uses expectedHead, not baseCommit, as the unexpected-commit baseline (repair re-entry)", async () => {
    // On leaf repair the worktree HEAD already sits at the orchestrator's prior
    // commit, which differs from baseCommit. Passing it as expectedHead means a
    // repair agent that does not commit is NOT mistaken for an unexpected commit,
    // so the orchestrator can commit the repaired diff normally.
    const git = new FakeGitRunner({
      heads: { [WORKTREE.path]: "ORCH_SHA" },
      diffCachedNameOnly: ["src/routes/tasks.ts"],
      diffCached: "patch",
      commitSha: "REPAIR_SHA"
    });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });

    const result = await recorder.record({
      worktree: WORKTREE,
      executorOutcome: okOutcome(),
      expectedHead: "ORCH_SHA",
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
    });

    expect(result.status).toBe("success");
    expect(result.commitSha).toBe("REPAIR_SHA");
    expect(result.agentCommittedUnexpectedly).toBeFalsy();
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
