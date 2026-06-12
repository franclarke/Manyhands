/**
 * INV-3 at the web seam — reconcileExecutionWorld drives checkpoint health +
 * physical reconciliation before a cold resume, persists the audit events
 * durably, filters invalidated results out of the execution artifact, and
 * resets the thread so the wavefront re-enters seeded with survivors.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileCheckpointSaver, type Checkpoint, type CheckpointMetadata } from "@manyhands/orchestrator-graph";
import type { RunExecutionResult } from "@manyhands/execution-core";
import { reconcileExecutionWorld, RunNotResumableError } from "@/lib/server/runs/world-reconcile";
import { hasExecutionCheckpoint } from "@/lib/server/runs/execution-host";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { ProvisionedRepo } from "@/lib/server/runs/repo-provisioner";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;
let repoRoot: string;
let baseCommit: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-recweb-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();

  repoRoot = path.join(tempDir, "repo");
  execFileSync("git", ["init", "-b", "main", repoRoot], { encoding: "utf8" });
  git(repoRoot, "config", "user.email", "test@mh.local");
  git(repoRoot, "config", "user.name", "MH Test");
  git(repoRoot, "commit", "--allow-empty", "-m", "base");
  baseCommit = git(repoRoot, "rev-parse", "HEAD");
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function provisionedFor(commit: string): ProvisionedRepo {
  return { repoRoot, baseBranch: "main", baseCommit: commit, cleanup: async () => undefined };
}

function makeRun(runId: string, execution: Partial<RunExecutionResult>): RunRecord {
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
    provisioned: { repoRoot, baseBranch: "main", baseCommit, provisionedAt: "2026-06-11T00:00:00.000Z" },
    execution
  };
}

function leafResult(taskId: string, commitSha?: string): Record<string, unknown> {
  return {
    taskId,
    status: commitSha !== undefined ? "success" : "validation_failed",
    ...(commitSha !== undefined ? { commitSha } : {}),
    executorExitCode: 0,
    executorDurationMs: 10,
    changedFiles: [],
    diff: ""
  };
}

async function putCheckpoint(runId: string, id: string): Promise<JsonFileCheckpointSaver> {
  const saver = new JsonFileCheckpointSaver(path.join(process.env.MANYHANDS_RUNS_DIR!, "checkpoints"));
  const checkpoint = {
    v: 1,
    id,
    ts: new Date().toISOString(),
    channel_values: {},
    channel_versions: {},
    versions_seen: {}
  } as unknown as Checkpoint;
  const metadata: CheckpointMetadata = { source: "input", step: 0, parents: {} };
  await saver.put({ configurable: { thread_id: runId } }, checkpoint, metadata, {});
  return saver;
}

async function eventsFor(runId: string): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
  const raw = await readFile(path.join(process.env.MANYHANDS_RUNS_DIR!, `${runId}.events.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
}

describe("reconcileExecutionWorld", () => {
  it("consistent world: keeps everything, no thread reset, audited", async () => {
    const runId = "run-web-clean";
    // Real evidence commit on an anchored branch.
    const worktreePath = path.join(repoRoot, ".manyhands", "worktrees", runId, "task-a");
    git(repoRoot, "worktree", "add", worktreePath, "-b", `mh/${runId}/task-a`, baseCommit);
    git(worktreePath, "commit", "--allow-empty", "-m", "mh: task-a");
    const sha = git(worktreePath, "rev-parse", "HEAD");
    git(repoRoot, "worktree", "remove", "--force", worktreePath);

    await getRunRepository().save(makeRun(runId, { leafResults: [leafResult("task-a", sha)] } as never));
    await putCheckpoint(runId, "chk-1");

    const outcome = await reconcileExecutionWorld(
      (await getRunRepository().get(runId)),
      provisionedFor(baseCommit)
    );
    expect(outcome.threadReset).toBe(false);
    expect(outcome.report.keptTaskIds).toEqual(["task-a"]);
    const events = await eventsFor(runId);
    expect(events.some((e) => e.type === "world.reconciled")).toBe(true);
    expect(await hasExecutionCheckpoint(runId)).toBe(true);
  });

  it("vanished evidence: filters the artifact, resets the thread, audits the invalidation", async () => {
    const runId = "run-web-invalid";
    await getRunRepository().save(
      makeRun(runId, {
        leafResults: [leafResult("task-gone", "0123456789abcdef0123456789abcdef01234567")]
      } as never)
    );
    await putCheckpoint(runId, "chk-1");

    const outcome = await reconcileExecutionWorld(
      (await getRunRepository().get(runId)),
      provisionedFor(baseCommit)
    );
    expect(outcome.threadReset).toBe(true);
    expect(outcome.report.invalidatedTaskIds).toEqual(["task-gone"]);

    const saved = await getRunRepository().get(runId);
    const execution = saved.execution as { leafResults: unknown[] };
    expect(execution.leafResults).toEqual([]);
    expect(await hasExecutionCheckpoint(runId)).toBe(false);

    const reconciledEvent = (await eventsFor(runId)).find((e) => e.type === "world.reconciled");
    expect(reconciledEvent?.payload.invalidatedTaskIds).toEqual(["task-gone"]);
  });

  it("corrupt latest.json: degraded resume is audited, run continues", async () => {
    const runId = "run-web-degraded";
    await getRunRepository().save(makeRun(runId, { leafResults: [] } as never));
    await putCheckpoint(runId, "chk-1");
    await putCheckpoint(runId, "chk-2");
    await writeFile(
      path.join(process.env.MANYHANDS_RUNS_DIR!, "checkpoints", runId, "latest.json"),
      "{ torn write",
      "utf-8"
    );

    const outcome = await reconcileExecutionWorld(
      (await getRunRepository().get(runId)),
      provisionedFor(baseCommit)
    );
    expect(outcome.threadReset).toBe(false);
    const degraded = (await eventsFor(runId)).find((e) => e.type === "checkpoint.degraded");
    expect(degraded?.payload.usedCheckpointId).toBe("chk-2");
    // The degraded thread still resumes (getTuple falls back to chk-2).
    expect(await hasExecutionCheckpoint(runId)).toBe(true);
  });

  it("unreachable base commit: not resumable — run interrupted with actionable message", async () => {
    const runId = "run-web-lostbase";
    await getRunRepository().save(makeRun(runId, { leafResults: [] } as never));
    await putCheckpoint(runId, "chk-1");

    await expect(
      reconcileExecutionWorld(
        (await getRunRepository().get(runId)),
        provisionedFor("feedfacefeedfacefeedfacefeedfacefeedface")
      )
    ).rejects.toBeInstanceOf(RunNotResumableError);

    const saved = await getRunRepository().get(runId);
    expect(saved.status).toBe("interrupted");
    expect(saved.errorMessage).toContain("commit base");
  });
});
