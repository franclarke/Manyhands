import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reconcileInvalidationClosure } from "@/lib/server/runs/execution-state";
import { recreateProvisionedRepo } from "@/lib/server/runs/repo-provisioner";
import type { TaskGraph } from "@manyhands/task-graph";

function graph(dependencies: Array<[string, string]>): TaskGraph {
  const ids = ["root", "a", "b", "c", "d"];
  return {
    id: "g",
    planId: "p",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "0".repeat(40),
    rootId: "root",
    createdAt: "2026-07-12T00:00:00.000Z",
    dependencies: dependencies.map(([fromTaskId, toTaskId]) => ({ fromTaskId, toTaskId })),
    nodes: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          id,
          parentId: id === "root" ? null : "root",
          kind: id === "root" ? "root" : "leaf",
          title: id,
          goal: id,
          status: "planned",
          granularity: "auto",
          depth: id === "root" ? 0 : 1,
          childrenIds: id === "root" ? ids.slice(1) : [],
          dependencies: dependencies.filter(([, to]) => to === id).map(([from]) => from)
        }
      ])
    )
  } as unknown as TaskGraph;
}

describe("B-016 reconciliation closure", () => {
  it("invalidates every downstream result in a chain and diamond from canonical graph.dependencies", () => {
    const chain = reconcileInvalidationClosure(graph([["a", "b"], ["b", "c"]]), ["a"]);
    expect([...chain].sort()).toEqual(["a", "b", "c", "root"]);

    const diamond = reconcileInvalidationClosure(
      graph([["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]),
      ["a"]
    );
    expect([...diamond].sort()).toEqual(["a", "b", "c", "d", "root"]);
  });

  it("recreates a missing run root from durable source evidence without invoking an executor", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "mh-root-recreate-"));
    try {
      const source = path.join(temp, "source");
      const executionRepo = path.join(temp, "runs", "run-root", "repo");
      execFileSync("git", ["init", "-b", "main", source], { encoding: "utf8" });
      execFileSync("git", ["config", "user.email", "test@mh.local"], { cwd: source });
      execFileSync("git", ["config", "user.name", "MH Test"], { cwd: source });
      execFileSync("git", ["commit", "--allow-empty", "-m", "base"], { cwd: source });
      const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();

      const recreated = await recreateProvisionedRepo({
        runId: "run-root",
        record: {
          repoRoot: executionRepo,
          sourceRepoRoot: source,
          sourceBranch: "main",
          sourceBaseCommit: sha,
          baseBranch: "main",
          baseCommit: sha,
          executionBaseCommit: sha,
          provisionedAt: "2026-07-12T00:00:00.000Z"
        }
      });

      expect(recreated.recreated).toBe(true);
      expect(existsSync(executionRepo)).toBe(true);
      expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: executionRepo, encoding: "utf8" }).trim()).toBe(sha);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
