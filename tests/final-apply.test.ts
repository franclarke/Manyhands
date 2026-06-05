import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyFinalPatch,
  buildRunBranchName,
  slugifyForBranch
} from "@/lib/server/runs/final-apply";
import { rmWithRetry } from "@/lib/server/runs/fs-retry";
import type { ProvisionedRepo } from "@/lib/server/runs/repo-provisioner";
import type { RunExecutionResult } from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function initRepo(repoRoot: string): Promise<string> {
  await mkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(path.join(repoRoot, "src", "index.ts"), "export const base = true;\n");
  git(repoRoot, "init", "-b", "main");
  git(repoRoot, "config", "user.name", "Test");
  git(repoRoot, "config", "user.email", "test@example.com");
  git(repoRoot, "config", "commit.gpgsign", "false");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-m", "base");
  return git(repoRoot, "rev-parse", "HEAD");
}

/** Builds an integration commit, then leaves HEAD back on the clean base. */
async function makeIntegrationCommit(repoRoot: string, baseCommit: string): Promise<string> {
  await writeFile(path.join(repoRoot, "src", "feature.ts"), "export const feature = true;\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-m", "integrated");
  const sha = git(repoRoot, "rev-parse", "HEAD");
  git(repoRoot, "reset", "--hard", baseCommit);
  return sha;
}

function provisioned(repoRoot: string, baseCommit: string): ProvisionedRepo {
  return { repoRoot, baseBranch: "main", baseCommit, cleanup: async () => undefined };
}

function graphWithRoot(baseCommit: string, repoRoot: string): TaskGraph {
  return {
    id: "graph",
    planId: "plan",
    repo: repoRoot,
    baseBranch: "main",
    baseCommit,
    rootId: "root",
    nodes: {},
    dependencies: []
  } as unknown as TaskGraph;
}

function resultWith(integrationCommitSha: string): RunExecutionResult {
  return {
    runId: "r1",
    status: "completed",
    leafResults: [],
    integrationResults: [
      {
        compositeTaskId: "root",
        status: "success",
        childResults: [],
        integrationCommitSha,
        repairAttempted: false
      }
    ],
    granularityVector: {} as RunExecutionResult["granularityVector"],
    totalDurationMs: 1
  };
}

describe("slugifyForBranch", () => {
  it("collapses to a ref-safe, capped, lowercase slug", () => {
    expect(slugifyForBranch("Add a REST API!! ")).toBe("add-a-rest-api");
    expect(slugifyForBranch("   ")).toBe("run");
    expect(slugifyForBranch("a".repeat(60)).length).toBeLessThanOrEqual(40);
  });
});

describe("buildRunBranchName", () => {
  it("produces a stable manyhands/run-<id>-<slug> name", () => {
    expect(buildRunBranchName("run-123", "My Feature")).toBe("manyhands/run-run-123-my-feature");
  });
});

describe("applyFinalPatch", () => {
  let tempDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-final-apply-"));
    repoRoot = path.join(tempDir, "repo");
    // Keep the worktree/export scratch space inside the temp dir.
    process.env.MANYHANDS_REPO_ROOT = tempDir;
  });

  afterEach(async () => {
    delete process.env.MANYHANDS_REPO_ROOT;
    // Windows can briefly hold the just-removed git worktree dir; retry on EBUSY.
    await rmWithRetry(tempDir).catch(() => undefined);
  });

  it("applies the result to a new branch from baseCommit, leaving HEAD untouched", async () => {
    const baseCommit = await initRepo(repoRoot);
    const integrationCommit = await makeIntegrationCommit(repoRoot, baseCommit);

    const record = await applyFinalPatch({
      graph: graphWithRoot(baseCommit, repoRoot),
      result: resultWith(integrationCommit),
      provisioned: provisioned(repoRoot, baseCommit),
      runId: "run-x",
      slug: "My Feature"
    });

    expect(record?.finalApplicationStatus).toBe("applied");
    const branch = buildRunBranchName("run-x", "My Feature");
    expect(record?.finalBranchName).toBe(branch);
    expect(record?.finalPatch).toContain("feature.ts");
    // The branch holds the applied commit...
    expect(git(repoRoot, "rev-parse", branch)).toBe(record?.finalCommitSha);
    expect(git(repoRoot, "show", `${branch}:src/feature.ts`)).toContain("feature");
    // ...but the user's branch and working tree are untouched.
    expect(git(repoRoot, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repoRoot, "rev-parse", "HEAD")).toBe(baseCommit);
    expect(git(repoRoot, "status", "--porcelain")).toBe("");
  }, 30000);

  it("still branches from baseCommit when the repo moved ahead (no crash)", async () => {
    const baseCommit = await initRepo(repoRoot);
    const integrationCommit = await makeIntegrationCommit(repoRoot, baseCommit);
    // The user advanced main past the base commit after the run started.
    await writeFile(path.join(repoRoot, "src", "later.ts"), "export const later = true;\n");
    git(repoRoot, "add", "-A");
    git(repoRoot, "commit", "-m", "later work");
    const movedHead = git(repoRoot, "rev-parse", "HEAD");

    const record = await applyFinalPatch({
      graph: graphWithRoot(baseCommit, repoRoot),
      result: resultWith(integrationCommit),
      provisioned: provisioned(repoRoot, baseCommit),
      runId: "run-moved",
      slug: "feature"
    });

    expect(record?.finalApplicationStatus).toBe("applied");
    expect(record?.finalBranchName).toBe(buildRunBranchName("run-moved", "feature"));
    // The user's HEAD is left exactly where they moved it.
    expect(git(repoRoot, "rev-parse", "HEAD")).toBe(movedHead);
  }, 30000);

  it("records a failed status (no throw) when the base commit is unreachable", async () => {
    const baseCommit = await initRepo(repoRoot);
    const integrationCommit = git(repoRoot, "rev-parse", "HEAD");

    const record = await applyFinalPatch({
      graph: graphWithRoot(baseCommit, repoRoot),
      result: resultWith(integrationCommit),
      provisioned: provisioned(repoRoot, "f".repeat(40)),
      runId: "run-gone",
      slug: "feature"
    });

    expect(record?.finalApplicationStatus).toBe("failed");
    expect(record?.finalApplicationMessage).toContain("no longer reachable");
  }, 30000);

  it("records a failed status (no throw) when the integrated patch is empty", async () => {
    const baseCommit = await initRepo(repoRoot);

    const record = await applyFinalPatch({
      graph: graphWithRoot(baseCommit, repoRoot),
      result: resultWith(baseCommit), // diff base..base is empty
      provisioned: provisioned(repoRoot, baseCommit),
      runId: "run-empty",
      slug: "feature"
    });

    expect(record?.finalApplicationStatus).toBe("failed");
    expect(record?.finalApplicationMessage).toContain("empty");
  }, 30000);
});
