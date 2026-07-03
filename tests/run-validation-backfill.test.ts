import { describe, expect, it } from "vitest";
import type { TaskGraph } from "@manyhands/task-graph";
import { backfillRunValidationCommands, deriveRunValidationSummary } from "@/lib/server/runs/execution-state";
import type { DetectedCommands } from "@/lib/server/providers/command-detection";

function graphWithRoot(rootContract?: Record<string, unknown>): TaskGraph {
  return {
    id: "graph",
    planId: "plan",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "0".repeat(40),
    rootId: "root",
    createdAt: "2026-06-16T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "root",
        title: "Root",
        goal: "root",
        status: "planned",
        granularity: "auto",
        depth: 0,
        childrenIds: ["leaf"],
        dependencies: [],
        ...(rootContract !== undefined ? { contract: rootContract } : {})
      }
    }
  } as unknown as TaskGraph;
}

const detected: DetectedCommands = { packageManager: "npm", test: "npm run test" };

describe("backfillRunValidationCommands", () => {
  it("injects the detected test command on a root with empty run validation", () => {
    const { graph, backfilled } = backfillRunValidationCommands(graphWithRoot({}), detected);
    expect(backfilled).toEqual({ command: "npm", args: ["run", "test"], timeoutMs: 120_000, cwd: "worktree" });
    const root = graph.nodes[graph.rootId] as { contract: { runValidationCommands: unknown[] } };
    expect(root.contract.runValidationCommands).toEqual([backfilled]);
  });

  it("does not overwrite run validation commands the LLM already authored", () => {
    const existing = [{ command: "pnpm", args: ["test"], timeoutMs: 60_000, cwd: "worktree" }];
    const input = graphWithRoot({ runValidationCommands: existing });
    const { graph, backfilled } = backfillRunValidationCommands(input, detected);
    expect(backfilled).toBeUndefined();
    const root = graph.nodes[graph.rootId] as { contract: { runValidationCommands: unknown[] } };
    expect(root.contract.runValidationCommands).toEqual(existing);
  });

  it("prefers test over build/typecheck/lint", () => {
    const all: DetectedCommands = {
      packageManager: "npm",
      test: "npm run test",
      build: "npm run build",
      typecheck: "npm run typecheck",
      lint: "npm run lint"
    };
    const { backfilled } = backfillRunValidationCommands(graphWithRoot({}), all);
    expect(backfilled?.args).toEqual(["run", "test"]);
  });

  it("is a no-op when no command was detected", () => {
    const input = graphWithRoot({});
    const { graph, backfilled } = backfillRunValidationCommands(input, { packageManager: "unknown" });
    expect(backfilled).toBeUndefined();
    const root = graph.nodes[graph.rootId] as { contract?: { runValidationCommands?: unknown[] } };
    expect(root.contract?.runValidationCommands ?? []).toEqual([]);
  });

  it("rejects a detected command that violates the safety whitelist", () => {
    const unsafe: DetectedCommands = { packageManager: "npm", test: "npm run test && rm -rf /" };
    const { backfilled } = backfillRunValidationCommands(graphWithRoot({}), unsafe);
    expect(backfilled).toBeUndefined();
  });

  it("does not mutate the input graph (pure)", () => {
    const input = graphWithRoot({});
    backfillRunValidationCommands(input, detected);
    const root = input.nodes[input.rootId] as { contract: { runValidationCommands?: unknown[] } };
    expect(root.contract.runValidationCommands).toBeUndefined();
  });
});

function graphWithRunCommand(): TaskGraph {
  return graphWithRoot({
    runValidationCommands: [{ command: "npm", args: ["run", "test"], timeoutMs: 120_000, cwd: "worktree" }]
  });
}

describe("deriveRunValidationSummary", () => {
  const at = "2026-06-16T00:00:00.000Z";

  it("marks completed runs with run commands as passed", () => {
    const summary = deriveRunValidationSummary(graphWithRunCommand(), "completed", { passed: true }, at);
    expect(summary).toEqual({ status: "passed", command: "npm run test", ranAt: at });
  });

  it("marks completed runs without run commands as unverified", () => {
    const summary = deriveRunValidationSummary(graphWithRoot({}), "completed", undefined, at);
    expect(summary).toEqual({ status: "unverified" });
  });

  it("marks failed runs whose run validation failed as failed", () => {
    const summary = deriveRunValidationSummary(graphWithRunCommand(), "failed", { passed: false }, at);
    expect(summary).toEqual({ status: "failed", command: "npm run test", ranAt: at });
  });

  it("returns undefined for failures unrelated to run validation", () => {
    expect(deriveRunValidationSummary(graphWithRoot({}), "failed", undefined, at)).toBeUndefined();
  });

  it("passed summary carries the exact command label", () => {
    const summary = deriveRunValidationSummary(graphWithRunCommand(), "completed", { passed: true }, at);
    expect(summary?.command).toBe("npm run test");
  });
});
