import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyFinalPatch,
  buildRunBranchName,
  slugifyForBranch
} from "@/lib/server/runs/final-apply";
import { rmWithRetry } from "@/lib/server/runs/fs-retry";
import { listFinalArtifactChanges, listFinalArtifactTree, readFinalArtifactFile } from "@/lib/server/runs/workspace-context";
import type { RunRecord } from "@/lib/server/runs/schema";
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

function provisioned(
  repoRoot: string,
  baseCommit: string,
  sourceBaseCommit: string = baseCommit
): ProvisionedRepo {
  return {
    repoRoot,
    sourceRepoRoot: repoRoot,
    sourceBranch: "main",
    sourceBaseCommit,
    baseBranch: "main",
    baseCommit,
    executionBaseCommit: baseCommit,
    cleanup: async () => undefined
  };
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
        repairAttempted: false,
        preMergeFindings: []
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
    expect(record?.finalArtifactManifest).toMatchObject({
      runId: "run-x",
      sourceBranch: "main",
      sourceBaseSha: baseCommit,
      executionBaseSha: baseCommit,
      finalSha: expect.any(String),
      addedFiles: ["src/feature.ts"],
      modifiedFiles: [],
      deletedFiles: [],
      artifactDisposition: "ready",
      deliveryDisposition: "needs_delivery"
    });
    const branch = buildRunBranchName("run-x", "My Feature");
    expect(record?.finalBranchName).toBe(branch);
    expect(record?.finalPatch).toContain("feature.ts");
    // The branch holds the applied commit...
    expect(git(repoRoot, "rev-parse", branch)).toBe(record?.finalCommitSha);
    expect(git(repoRoot, "show", `${branch}:src/feature.ts`)).toContain("feature");
    const viewerRun = {
      provisioned: { repoRoot },
      finalArtifactManifest: record?.finalArtifactManifest
    } as RunRecord;
    expect(await readFinalArtifactFile(viewerRun, "src/feature.ts")).toBe(
      git(repoRoot, "show", `${record!.finalCommitSha}:src/feature.ts`) + "\n"
    );
    await writeFile(path.join(repoRoot, "src", "feature.ts"), "source checkout diverged\n");
    expect(await readFinalArtifactFile(viewerRun, "src/feature.ts")).toBe(
      git(repoRoot, "show", `${record!.finalCommitSha}:src/feature.ts`) + "\n"
    );
    await expect(
      readFinalArtifactFile(viewerRun, "src/feature.ts", { finalSha: baseCommit })
    ).rejects.toThrow(/does not match/i);
    expect(await listFinalArtifactTree(viewerRun, "src")).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "src/feature.ts", kind: "file", mode: "100644" })])
    );
    expect(await listFinalArtifactChanges(viewerRun)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "A", path: "src/feature.ts" })])
    );
    await rm(path.join(repoRoot, "src", "feature.ts"));
    // ...but the user's branch and working tree are untouched.
    expect(git(repoRoot, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repoRoot, "rev-parse", "HEAD")).toBe(baseCommit);
    expect(git(repoRoot, "status", "--porcelain")).toBe("");
  }, 30000);

  it("includes the grounding commit by diffing the final artifact from sourceBaseCommit", async () => {
    const sourceBaseCommit = await initRepo(repoRoot);
    await writeFile(path.join(repoRoot, "src", "grounding.ts"), "export const grounded = true;\n");
    git(repoRoot, "add", "-A");
    git(repoRoot, "commit", "-m", "grounding");
    const executionBaseCommit = git(repoRoot, "rev-parse", "HEAD");
    const integrationCommit = await makeIntegrationCommit(repoRoot, executionBaseCommit);

    const result = await applyFinalPatch({
      graph: graphWithRoot(executionBaseCommit, repoRoot),
      result: resultWith(integrationCommit),
      provisioned: provisioned(repoRoot, executionBaseCommit, sourceBaseCommit),
      runId: "run-grounded",
      slug: "grounded feature"
    });

    expect(result?.finalApplicationStatus).toBe("applied");
    expect(result?.finalPatch).toContain("grounding.ts");
    expect(result?.finalPatch).toContain("feature.ts");
    expect(git(repoRoot, "show", `${result!.finalCommitSha}:src/grounding.ts`)).toContain("grounded");
    expect(git(repoRoot, "show", `${result!.finalCommitSha}:src/feature.ts`)).toContain("feature");
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
    expect(record?.finalArtifactManifest?.artifactDisposition).toBe("failed");
  }, 30000);

  it("derives deleted files from the real base..final commits", async () => {
    const baseCommit = await initRepo(repoRoot);
    git(repoRoot, "rm", "src/index.ts");
    git(repoRoot, "commit", "-m", "delete index");
    const integrationCommit = git(repoRoot, "rev-parse", "HEAD");
    git(repoRoot, "reset", "--hard", baseCommit);
    const record = await applyFinalPatch({
      graph: graphWithRoot(baseCommit, repoRoot), result: resultWith(integrationCommit),
      provisioned: provisioned(repoRoot, baseCommit), runId: "run-delete", slug: "delete"
    });
    expect(record?.finalArtifactManifest?.deletedFiles).toEqual(["src/index.ts"]);
  }, 30000);
});
