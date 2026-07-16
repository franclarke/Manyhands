import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as POST_RUNS } from "@/app/api/runs/route";
import { POST as POST_FORK } from "@/app/api/runs/[id]/fork/route";
import { POST as POST_RESTART } from "@/app/api/runs/[id]/restart/route";
import { JsonFileCheckpointSaver } from "@manyhands/orchestrator-graph";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { resetWorkspaceRepositoryForTests } from "@/lib/server/workspaces/store";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";
import { executionSelection, planningSelection, repairSelection } from "@/lib/server/runs/executor-selection";
import { captureRunTargetContext } from "@/lib/server/runs/target-context";

let tempDir: string;
let prevForce: string | undefined;
let prevClaude: string | undefined;
let prevCodex: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-stage-life-"));
  prevForce = process.env.MANYHANDS_FORCE_FALLBACK;
  prevClaude = process.env.MANYHANDS_CLAUDE_BIN;
  prevCodex = process.env.MANYHANDS_CODEX_BIN;
  process.env.MANYHANDS_FORCE_FALLBACK = "1";
  const bin = await writeFakeTitlerBin(tempDir);
  process.env.MANYHANDS_CLAUDE_BIN = bin;
  process.env.MANYHANDS_CODEX_BIN = bin;
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
});

afterEach(async () => {
  await drainAllRunBackgroundTasksForTests();
  if (prevForce === undefined) delete process.env.MANYHANDS_FORCE_FALLBACK;
  else process.env.MANYHANDS_FORCE_FALLBACK = prevForce;
  if (prevClaude === undefined) delete process.env.MANYHANDS_CLAUDE_BIN;
  else process.env.MANYHANDS_CLAUDE_BIN = prevClaude;
  if (prevCodex === undefined) delete process.env.MANYHANDS_CODEX_BIN;
  else process.env.MANYHANDS_CODEX_BIN = prevCodex;
  delete process.env.MANYHANDS_WORKSPACES_FILE;
  delete process.env.MANYHANDS_RUNS_DIR;
  resetWorkspaceRepositoryForTests();
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFakeTitlerBin(dir: string): Promise<string> {
  const output = JSON.stringify({ title: "Generated title", summary: "Generated summary." });
  const file = path.join(dir, process.platform === "win32" ? "fake-titler.cmd" : "fake-titler.sh");
  const content = process.platform === "win32" ? `@echo off\r\necho ${output}\r\n` : `#!/bin/sh\nprintf '%s\\n' '${output}'\n`;
  await writeFile(file, content, "utf8");
  await chmod(file, 0o755).catch(() => undefined);
  return file;
}

async function createRun(repoPath?: string): Promise<string> {
  const workspace = await getWorkspaceRepository().create({
    name: "WS",
    ...(repoPath !== undefined ? { repoPath } : {})
  });
  const res = await POST_RUNS(
    new Request("http://manyhands.test/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: workspace.id,
        granularity: "balanced",
        userPrompt: "Build it",
        model: "gpt-5.5",
        planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "high" },
        executionSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" }
      })
    })
  );
  const { run } = (await res.json()) as { run: { runId: string } };
  return run.runId;
}

async function makeGitRepo(name: string): Promise<string> {
  const repoRoot = path.join(tempDir, name);
  await mkdir(repoRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repoRoot]);
  execFileSync("git", ["config", "user.email", "t@mh.local"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "file.txt"), name, "utf8");
  execFileSync("git", ["add", "."], { cwd: repoRoot });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

async function checkpointThreads(): Promise<string[]> {
  return readdir(path.join(process.env.MANYHANDS_RUNS_DIR!, "checkpoints"))
    .then((entries) => entries.sort())
    .catch(() => []);
}

describe("StageSelection lifecycle", () => {
  it("keeps persisted selections identical to effective on read (selected == persisted == effective)", async () => {
    const runId = await createRun();
    const saved = await getRunRepository().get(runId);
    expect(saved.planningSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(saved.executionSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
    // The resolver (used by planning/execution pipelines on resume/restart) reads
    // the very same values back — a restart re-reads this record unchanged.
    expect(planningSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(executionSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
    expect(repairSelection(saved)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
  });

  it("preserves canonical per-stage selections across a fork", async () => {
    const runId = await createRun();
    // Let the background planning task settle so the run reaches a forkable state.
    await drainAllRunBackgroundTasksForTests();
    const repoRoot = await makeGitRepo("fork-source-repo");
    const sourceIdentity = (await captureRunTargetContext(repoRoot))!;
    await getRunRepository().update(runId, (current) => ({
      ...current,
      targetContext: {
        ...sourceIdentity,
        executionRepoPath: "C:/isolated/execution",
        executionBaseCommit: "b".repeat(40)
      }
    }));
    const res = await POST_FORK(
      new Request(`http://manyhands.test/api/runs/${runId}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }),
      { params: Promise.resolve({ id: runId }) }
    );
    expect(res.status).toBe(201);
    const { run } = (await res.json()) as { run: { runId: string } };
    const forked = await getRunRepository().get(run.runId);
    expect(forked.planningSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(forked.executionSelection).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
    expect(planningSelection(forked)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(executionSelection(forked)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
    expect(forked.targetContext).toEqual(sourceIdentity);
    expect(forked.targetContext?.executionRepoPath).toBeUndefined();
    expect(forked.targetContext?.executionBaseCommit).toBeUndefined();
    expect(forked.provisioned).toBeUndefined();
  });

  it("refuses to fork a legacy local target without physical identity evidence", async () => {
    const runId = await createRun();
    await drainAllRunBackgroundTasksForTests();
    await getRunRepository().update(runId, (current) => ({
      ...current,
      repoSpec: { kind: "localPath", path: "C:/legacy/repo" },
      targetContext: {
        sourceRealPath: "C:/legacy/repo",
        gitCommonDir: "C:/legacy/repo/.git",
        sourceBranch: "main",
        sourceBaseCommit: "a".repeat(40),
        fingerprint: "legacy-target-fingerprint",
        capturedAt: "2026-07-15T10:00:00.000Z"
      }
    }));

    const response = await POST_FORK(
      new Request(`http://manyhands.test/api/runs/${runId}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      { params: Promise.resolve({ id: runId }) }
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/no captured physical repository identity|new run/i);
    expect((await getRunRepository().list()).map((run) => run.runId)).toEqual([runId]);
  });

  it("refuses to fork while a durable operation owns the source run", async () => {
    const runId = await createRun();
    await drainAllRunBackgroundTasksForTests();
    const heartbeatAt = new Date().toISOString();
    const source = await getRunRepository().update(runId, (current) => ({
      ...current,
      status: "failed",
      failedDuring: "running",
      mutationFence: Math.max(current.mutationFence ?? 0, 7),
      activeOperation: {
        operationId: "77777777-7777-4777-8777-777777777777",
        kind: "execution",
        fencingToken: 7,
        acquiredAt: heartbeatAt,
        heartbeatAt
      }
    }));
    const checkpointThreadsBefore = await checkpointThreads();

    const response = await POST_FORK(
      new Request(`http://manyhands.test/api/runs/${runId}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      { params: Promise.resolve({ id: runId }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/operation claim rejected|still active/i),
      conflict: { currentStatus: "failed", currentVersion: source.version }
    });
    expect((await getRunRepository().list()).map((run) => run.runId)).toEqual([runId]);
    expect(await checkpointThreads()).toEqual(checkpointThreadsBefore);
  });

  it("holds durable fork authority so restart cannot reset checkpoints mid-clone", async () => {
    const runId = await createRun();
    await drainAllRunBackgroundTasksForTests();
    await getRunRepository().update(runId, (current) => ({
      ...current,
      status: "failed",
      failedDuring: "generating"
    }));
    const checkpointThreadsBefore = await checkpointThreads();

    let notifyCheckpointRead!: () => void;
    const checkpointReadStarted = new Promise<void>((resolve) => {
      notifyCheckpointRead = resolve;
    });
    let releaseCheckpointRead!: () => void;
    const checkpointReadGate = new Promise<void>((resolve) => {
      releaseCheckpointRead = resolve;
    });
    const getTuple = vi
      .spyOn(JsonFileCheckpointSaver.prototype, "getTuple")
      .mockImplementation(async () => {
        notifyCheckpointRead();
        await checkpointReadGate;
        return undefined;
      });

    try {
      const forkResponsePromise = POST_FORK(
        new Request(`http://manyhands.test/api/runs/${runId}/fork`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        }),
        { params: Promise.resolve({ id: runId }) }
      );
      await checkpointReadStarted;
      await expect(getRunRepository().get(runId)).resolves.toMatchObject({
        status: "failed",
        activeOperation: { kind: "fork" }
      });

      const restartResponse = await POST_RESTART(
        new Request(`http://manyhands.test/api/runs/${runId}/restart`, { method: "POST" }),
        { params: Promise.resolve({ id: runId }) }
      );
      expect(restartResponse.status).toBe(409);
      expect((await restartResponse.json()).error).toMatch(/fresh heartbeat|still active|operation claim rejected/i);
      expect(await checkpointThreads()).toEqual(checkpointThreadsBefore);

      releaseCheckpointRead();
      const forkResponse = await forkResponsePromise;
      expect(forkResponse.status).toBe(201);
      expect((await getRunRepository().get(runId)).activeOperation).toBeUndefined();
    } finally {
      releaseCheckpointRead();
      getTuple.mockRestore();
    }
  });

  it("refuses to fork when a different repository replaces the captured target path", async () => {
    const repoRoot = await makeGitRepo("replaceable-fork-source");
    const runId = await createRun(repoRoot);
    await drainAllRunBackgroundTasksForTests();
    const captured = (await getRunRepository().get(runId)).targetContext;
    expect(captured?.physicalIdentity).toBeDefined();
    const checkpointThreadsBefore = await checkpointThreads();

    await rename(repoRoot, path.join(tempDir, "moved-original-fork-source"));
    const replacementRoot = await makeGitRepo("replaceable-fork-source");
    expect((await captureRunTargetContext(replacementRoot))?.physicalIdentity).not.toEqual(
      captured?.physicalIdentity
    );

    const response = await POST_FORK(
      new Request(`http://manyhands.test/api/runs/${runId}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      { params: Promise.resolve({ id: runId }) }
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/different physical repository|replaced|recreated/i);
    expect((await getRunRepository().list()).map((run) => run.runId)).toEqual([runId]);
    expect(await checkpointThreads()).toEqual(checkpointThreadsBefore);
  });
});
