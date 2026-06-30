/**
 * PR 1 (A-01) — the `deliver` route must refuse destructive git operations
 * (merge/discard/cleanup) on a run that is NOT terminal or that still has an
 * active in-process runner. Otherwise a delivery can merge/clean worktrees and
 * branches while the execution pipeline is still driving the run, corrupting an
 * in-flight integration or deleting evidence of a resumable run.
 *
 * Each 409 case below uses a run where the action would OTHERWISE return 200,
 * so the test fails against the current unguarded route (true red) rather than
 * passing on an unrelated DeliveryError (which also maps to 409).
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_DELIVER } from "@/app/api/runs/[id]/deliver/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { markRunnerActive, markRunnerInactive } from "@/lib/server/runs/runner-state";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;
const activeRunIds = new Set<string>();

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-deliver-guard-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  for (const id of activeRunIds) markRunnerInactive(id);
  activeRunIds.clear();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A plain git repo — enough for `cleanup` to run to completion (200). */
function makeGitRepo(name: string): string {
  const repoRoot = path.join(tempDir, name);
  execFileSync("git", ["init", "-b", "main", repoRoot], { encoding: "utf8" });
  git(repoRoot, "config", "user.email", "test@mh.local");
  git(repoRoot, "config", "user.name", "MH Test");
  git(repoRoot, "commit", "--allow-empty", "-m", "base");
  return repoRoot;
}

/** A repo with an applied run branch ahead of main — enough for `merge` to succeed (200). */
function makeAppliedRepo(
  runId: string
): { repoRoot: string; baseCommit: string; finalBranchName: string; finalCommitSha: string } {
  const repoRoot = makeGitRepo(`repo-${runId}`);
  const baseCommit = git(repoRoot, "rev-parse", "HEAD");
  const finalBranchName = `manyhands/run-${runId}`;
  git(repoRoot, "checkout", "-b", finalBranchName);
  git(repoRoot, "commit", "--allow-empty", "-m", "run work");
  const finalCommitSha = git(repoRoot, "rev-parse", "HEAD");
  git(repoRoot, "checkout", "main");
  return { repoRoot, baseCommit, finalBranchName, finalCommitSha };
}

function makeRun(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "completed",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    patches: [],
    ...overrides
  };
}

function postDeliver(runId: string, action: "merge" | "discard" | "cleanup" | "reveal"): Promise<Response> {
  return POST_DELIVER(
    new Request("http://mh.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

describe("POST deliver — lifecycle guard (A-01)", () => {
  it("rejects cleanup while the run is still running (409)", async () => {
    const runId = "run-deliver-running";
    const repoRoot = makeGitRepo("repo-running");
    await getRunRepository().save(makeRun(runId, { status: "running", appliedToRepoPath: repoRoot }));

    const res = await postDeliver(runId, "cleanup");

    expect(res.status).toBe(409);
  });

  it("rejects merge while the run is still running (409)", async () => {
    const runId = "run-deliver-merge-running";
    const applied = makeAppliedRepo(runId);
    await getRunRepository().save(
      makeRun(runId, {
        status: "running",
        finalApplicationStatus: "applied",
        appliedToRepoPath: applied.repoRoot,
        finalBranchName: applied.finalBranchName,
        finalCommitSha: applied.finalCommitSha,
        baseCommit: applied.baseCommit
      })
    );

    const res = await postDeliver(runId, "merge");

    expect(res.status).toBe(409);
  });

  it("rejects cleanup on a terminal run while a runner is still active (409)", async () => {
    const runId = "run-deliver-runner-active";
    const repoRoot = makeGitRepo("repo-active");
    await getRunRepository().save(makeRun(runId, { status: "completed", appliedToRepoPath: repoRoot }));
    markRunnerActive(runId);
    activeRunIds.add(runId);

    const res = await postDeliver(runId, "cleanup");

    expect(res.status).toBe(409);
  });

  it("allows cleanup on a terminal run with no active runner (200)", async () => {
    const runId = "run-deliver-completed";
    const repoRoot = makeGitRepo("repo-completed");
    await getRunRepository().save(makeRun(runId, { status: "completed", appliedToRepoPath: repoRoot }));

    const res = await postDeliver(runId, "cleanup");

    expect(res.status).toBe(200);
  });

  it("does not block reveal with the lifecycle guard", async () => {
    // No appliedToRepoPath + no workspace → reveal returns 400 (no local folder),
    // never reaching the file explorer. The point: the guard must NOT turn this
    // into a 409 on a running run.
    const runId = "run-deliver-reveal-running";
    await getRunRepository().save(makeRun(runId, { status: "running" }));

    const res = await postDeliver(runId, "reveal");

    expect(res.status).not.toBe(409);
  });
});
