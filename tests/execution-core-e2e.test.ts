import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExecutionConfigSchema,
  MockCodexCliExecutor,
  RunExecutor,
  SimpleGitRunner
} from "@manyhands/execution-core";

const RUN_ID = "run-e2e";

let repoRoot: string;
let baseCommit: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function leafPath(taskId: string): string {
  return `${repoRoot}/.manyhands/worktrees/${RUN_ID}/${taskId}`;
}

function graphWith(leafIds: string[]): TaskGraph {
  return {
    id: "graph-e2e",
    planId: RUN_ID,
    repo: repoRoot,
    baseBranch: "main",
    baseCommit,
    featureRequest: "Implement three independent modules.",
    rootId: "root",
    createdAt: "2026-05-28T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "composite",
        title: "Root",
        goal: "Coordinate the modules.",
        status: "planned",
        granularity: "medium",
        depth: 0,
        childrenIds: leafIds,
        dependencies: []
      },
      ...Object.fromEntries(
        leafIds.map((taskId) => [
          taskId,
          {
            id: taskId,
            parentId: "root",
            kind: "leaf" as const,
            title: taskId,
            goal: `Implement ${taskId}.`,
            status: "planned" as const,
            granularity: "fine" as const,
            depth: 1,
            childrenIds: [],
            dependencies: [],
            acceptanceCriteria: ["module exists"]
          }
        ])
      )
    }
  };
}

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(os.tmpdir(), "mh-e2e-"));
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "ManyHands Test"]);
  git(["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repoRoot, "README.md"), "base\n");
  git(["add", "-A"]);
  git(["commit", "-m", "initial"]);
  baseCommit = git(["rev-parse", "HEAD"]);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe("RunExecutor E2E (real git + MockCodex)", () => {
  it("runs leaves, commits, cherry-picks into the composite, and completes", async () => {
    // Each leaf writes a distinct file so cherry-picks never conflict.
    const behaviors = {
      [leafPath("a")]: { filesToWrite: { "src/a.ts": "export const a = 1;\n" } },
      [leafPath("b")]: { filesToWrite: { "src/b.ts": "export const b = 2;\n" } },
      [leafPath("c")]: { filesToWrite: { "src/c.ts": "export const c = 3;\n" } }
    };
    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git: new SimpleGitRunner(),
      codex: new MockCodexCliExecutor({ behaviors }),
      traceStore,
      repoRoot
    });

    const result = await executor.run({
      graph: graphWith(["a", "b", "c"]),
      config: ExecutionConfigSchema.parse({}),
      model: "gpt-5-codex",
      runId: RUN_ID
    });

    expect(result.status).toBe("completed");

    expect(result.leafResults).toHaveLength(3);
    expect(result.leafResults.every((leaf) => leaf.status === "success")).toBe(true);
    expect(result.leafResults.every((leaf) => leaf.commitSha !== undefined)).toBe(true);

    expect(result.integrationResults).toHaveLength(1);
    expect(result.integrationResults[0]?.status).toBe("success");

    expect(result.granularityVector.leafCount).toBe(3);
    expect(result.granularityVector.compositeCount).toBe(1);
    expect(result.granularityVector.leafSuccessRate).toBe(1);
    expect(result.granularityVector.integrationSuccessRate).toBe(1);
    expect(result.granularityVector.conflictRate).toBe(0);

    // Trace fidelity: one worktree per leaf + the integration worktree.
    expect(traceStore.findByType("worktree_created")).toHaveLength(4);
    expect(traceStore.findByType("agent_committed")).toHaveLength(3);
    expect(traceStore.findByType("integration_completed")).toHaveLength(1);
    expect(traceStore.findByType("run_completed")).toHaveLength(1);

    // run_completed is the last event emitted.
    const events = traceStore.list();
    expect(events.at(-1)?.type).toBe("run_completed");

    // The integration commit contains all three module files.
    const integrationSha = result.integrationResults[0]?.integrationCommitSha;
    expect(integrationSha).toBeDefined();
    const tree = git(["ls-tree", "-r", "--name-only", integrationSha as string]);
    expect(tree).toContain("src/a.ts");
    expect(tree).toContain("src/b.ts");
    expect(tree).toContain("src/c.ts");
  }, 60_000);
});
