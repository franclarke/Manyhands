/**
 * INV-2 at the cancel endpoint — real git repo, real worktree, real process.
 *
 * Cancelling a running run must: (1) claim `interrupted` atomically, (2) kill
 * and VERIFY every registered subprocess before responding, (3) GC the run's
 * worktrees and branches by directory convention, (4) leave an audited
 * `run.cancelled` event with the kill/GC inventory, (5) keep the run
 * restartable. A second cancel gets the structured 409 (INV-4).
 */
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProcessAlive, registerLiveProcess } from "@manyhands/execution-core";
import { POST as POST_CANCEL } from "@/app/api/runs/[id]/cancel/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-cancel-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function makeRepoWithWorktree(runId: string, taskId: string): Promise<{ repoRoot: string; baseCommit: string }> {
  const repoRoot = path.join(tempDir, "repo");
  execFileSync("git", ["init", "-b", "main", repoRoot], { encoding: "utf8" });
  git(repoRoot, "config", "user.email", "test@mh.local");
  git(repoRoot, "config", "user.name", "MH Test");
  git(repoRoot, "commit", "--allow-empty", "-m", "base");
  const baseCommit = git(repoRoot, "rev-parse", "HEAD");
  const worktreePath = path.join(repoRoot, ".manyhands", "worktrees", runId, taskId);
  git(repoRoot, "worktree", "add", worktreePath, "-b", `mh/${runId}/${taskId}`, baseCommit);
  return { repoRoot, baseCommit };
}

function makeRun(runId: string, repoRoot: string, baseCommit: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "running",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    patches: [],
    provisioned: {
      repoRoot,
      baseBranch: "main",
      baseCommit,
      provisionedAt: "2026-06-11T00:00:00.000Z"
    }
  };
}

function postCancel(runId: string): Promise<Response> {
  return POST_CANCEL(new Request("http://mh.test", { method: "POST" }), {
    params: Promise.resolve({ id: runId })
  });
}

describe("POST cancel — verified kill + worktree GC", () => {
  it("kills registered processes, cleans worktrees/branches, and audits the cancellation", async () => {
    const runId = `run-cancel-e2e-${Date.now()}`;
    const { repoRoot, baseCommit } = await makeRepoWithWorktree(runId, "task-1");
    await getRunRepository().save(makeRun(runId, repoRoot, baseCommit));

    // A live agent subprocess registered under the run, as the executor driver does.
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      stdio: "ignore",
      detached: process.platform !== "win32"
    });
    await new Promise((resolve) => child.once("spawn", resolve));
    registerLiveProcess(runId, child);
    const pid = child.pid as number;
    expect(isProcessAlive(pid)).toBe(true);

    const response = await postCancel(runId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      run: { status: string };
      cancellation: { processesKilled: number; allProcessesDead: boolean; worktreesCleaned: number };
    };

    // 1) Status claimed atomically.
    expect(body.run.status).toBe("interrupted");
    // 2) The process is verified dead BEFORE the response.
    expect(body.cancellation.allProcessesDead).toBe(true);
    expect(body.cancellation.processesKilled).toBe(1);
    expect(isProcessAlive(pid)).toBe(false);
    // 3) Worktree directory and branch are gone.
    expect(body.cancellation.worktreesCleaned).toBe(1);
    expect(existsSync(path.join(repoRoot, ".manyhands", "worktrees", runId))).toBe(false);
    expect(git(repoRoot, "branch", "--list", `mh/${runId}/*`)).toBe("");
    // 4) Audited run.cancelled event in the persisted log.
    const log = await readFile(path.join(process.env.MANYHANDS_RUNS_DIR!, `${runId}.events.jsonl`), "utf8");
    const cancelled = log
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> })
      .find((event) => event.type === "run.cancelled");
    expect(cancelled).toBeDefined();
    expect(cancelled?.payload.killedProcesses).toBe(1);
    expect(cancelled?.payload.cleanedWorktrees).toEqual(["task-1"]);
    // 5) Restartable.
    const saved = await getRunRepository().get(runId);
    expect(saved.status).toBe("interrupted");
    expect(saved.interruptedDuring).toBe("running");
  });

  it("second cancel gets the structured 409 (the claim already consumed the status)", async () => {
    const runId = "run-cancel-twice";
    const { repoRoot, baseCommit } = await makeRepoWithWorktree(runId, "task-1");
    await getRunRepository().save(makeRun(runId, repoRoot, baseCommit));

    expect((await postCancel(runId)).status).toBe(200);
    const second = await postCancel(runId);
    expect(second.status).toBe(409);
    const body = (await second.json()) as { conflict?: { currentStatus: string } };
    expect(body.conflict?.currentStatus).toBe("interrupted");
  });

  it("cancels a planning run (no provisioned repo) without touching git", async () => {
    const runId = "run-cancel-planning";
    const run = makeRun(runId, "unused", "unused");
    delete (run as Partial<RunRecord>).provisioned;
    await getRunRepository().save({ ...run, status: "generating" });

    const response = await postCancel(runId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { run: { status: string }; cancellation: { worktreesCleaned: number } };
    expect(body.run.status).toBe("interrupted");
    expect(body.cancellation.worktreesCleaned).toBe(0);
    expect((await getRunRepository().get(runId)).interruptedDuring).toBe("generating");
  });
});
