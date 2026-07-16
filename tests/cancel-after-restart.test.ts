/**
 * RU1 (F2B-1) — end-to-end reproduction: cancel AFTER a server restart.
 *
 * Before RU1, cancelRun consulted only the in-memory live-process registry; a
 * restart emptied it, killOwnedProcessTrees returned a vacuous
 * { verifications: [], allDead: true }, and the run reached `interrupted`
 * while the orphan executor kept running.
 *
 * Here we spawn a REAL long-lived Node child, persist its durable evidence
 * (what the supervisor sink does at spawn time), and deliberately DO NOT
 * register it in the in-memory registry — exactly the post-restart state.
 * cancelRun must find it through the durable journal, verify its identity,
 * kill its tree, and only then report a terminal cancellation.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProcessAlive } from "@manyhands/execution-core";
import { cancelRun } from "@/lib/server/runs/cancel-service";
import { JsonRunProcessJournal } from "@/lib/server/runs/process-evidence";
import type { RunRecord } from "@/lib/server/runs/schema";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";

let tempDir: string;
let previousRunsDir: string | undefined;
const spawned: ChildProcess[] = [];

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-cancel-restart-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  for (const child of spawned) {
    try {
      if (typeof child.pid === "number" && isProcessAlive(child.pid)) child.kill("SIGKILL");
    } catch {
      // best-effort teardown
    }
  }
  spawned.length = 0;
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(runId: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-sonnet",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    planRevision: 1,
    status: "running",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    patches: []
  };
}

function spawnLongLivedChild(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
    detached: process.platform !== "win32"
  });
  spawned.push(child);
  return child;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}

describe("cancel after server restart (durable orphan kill)", () => {
  it("finds, verifies and kills a durable orphan the in-memory registry no longer knows", async () => {
    const runId = "run-restart-1";
    await getRunRepository().save(makeRun(runId));

    const child = spawnLongLivedChild();
    expect(child.pid).toBeTypeOf("number");
    const pid = child.pid!;
    expect(isProcessAlive(pid)).toBe(true);

    // Durable evidence as the supervisor sink would have left it pre-restart.
    // The in-memory registry is intentionally left empty (fresh process).
    const journal = new JsonRunProcessJournal();
    await journal.recordStart(runId, { pid, label: "executor", command: "node" });

    const outcome = await cancelRun(runId);

    expect(outcome.killReport.verifications.map((v) => v.pid)).toContain(pid);
    expect(outcome.killReport.allDead).toBe(true);
    expect(outcome.terminal).toBe(true);
    expect(outcome.run.status).toBe("interrupted");
    expect(await waitFor(() => !isProcessAlive(pid), 5_000)).toBe(true);

    // Evidence closed: nothing open remains for this run.
    expect(await journal.listOpen(runId)).toHaveLength(0);
  }, 30_000);

  it("a repeated cancel after the terminal one is a deterministic 409, not a re-kill", async () => {
    const runId = "run-restart-2";
    await getRunRepository().save(makeRun(runId));

    const child = spawnLongLivedChild();
    const pid = child.pid!;
    const journal = new JsonRunProcessJournal();
    await journal.recordStart(runId, { pid, label: "executor", command: "node" });

    const first = await cancelRun(runId);
    expect(first.terminal).toBe(true);
    expect(first.run.status).toBe("interrupted");

    // The terminal cancel consumed the cancellable status: a duplicate request
    // gets the existing deterministic conflict (INV-4) and, crucially, kills
    // nothing again — the durable evidence is already closed.
    await expect(cancelRun(runId)).rejects.toMatchObject({ name: "RunMutationConflictError" });
    expect(await journal.listOpen(runId)).toHaveLength(0);
  }, 30_000);

  it("kills the descendant tree of a durable orphan (grandchild included)", async () => {
    const runId = "run-restart-3";
    await getRunRepository().save(makeRun(runId));

    // Child spawns a grandchild and prints its pid, then idles.
    const script =
      "const {spawn} = require('child_process');" +
      "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {stdio: 'ignore'});" +
      "console.log('GRANDCHILD=' + g.pid);" +
      "setInterval(() => {}, 1000);";
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "ignore"],
      detached: process.platform !== "win32"
    });
    spawned.push(child);
    const pid = child.pid!;

    const grandchildPid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("grandchild pid not reported")), 10_000);
      let buffer = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const match = buffer.match(/GRANDCHILD=(\d+)/);
        if (match !== null) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
    expect(isProcessAlive(grandchildPid)).toBe(true);

    const journal = new JsonRunProcessJournal();
    await journal.recordStart(runId, { pid, label: "executor", command: "node" });

    const outcome = await cancelRun(runId);

    expect(outcome.killReport.allDead).toBe(true);
    expect(await waitFor(() => !isProcessAlive(pid), 5_000)).toBe(true);
    expect(await waitFor(() => !isProcessAlive(grandchildPid), 5_000)).toBe(true);
  }, 45_000);
});
