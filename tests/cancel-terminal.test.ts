/**
 * B-005 — cancellation is terminal only when every process is verified dead
 * (CF-06).
 *
 * The old cancel transitioned straight to `interrupted` and answered 200 even
 * with `killReport.allDead === false`. The hardened semantics:
 *
 *  1. cancel invalidates the operation lease and moves the run to `cancelling`;
 *  2. the run REMAINS `cancelling` while any process tree survives;
 *  3. only a verified `allDead=true` reaches the resumable `interrupted` state;
 *  4. retrying cancel from `cancelling` is allowed and finishes the job.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KillReport } from "@manyhands/execution-core";
import { cancelRun } from "@/lib/server/runs/cancel-service";
import { claimRunOperation } from "@/lib/server/runs/run-operation-lease";
import type { RunRecord } from "@/lib/server/runs/schema";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-cancel-terminal-"));
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

function makeRun(runId: string, status: RunRecord["status"] = "running"): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-sonnet",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    patches: []
  };
}

function survivorReport(runId: string): KillReport {
  return {
    ownerId: runId,
    verifications: [{ pid: 424242, outcome: "survived", waitedMs: 12, label: "executor" }],
    allDead: false
  };
}

function cleanReport(runId: string): KillReport {
  return { ownerId: runId, verifications: [], allDead: true };
}

describe("B-005 cancelRun — terminal only with allDead", () => {
  it("stays in cancelling while survivors remain and reaches interrupted only after a clean retry", async () => {
    const runId = "run-cancel-survivors";
    await getRunRepository().save(makeRun(runId));
    const claimed = await claimRunOperation(runId, "execution", { expectedStatuses: ["running"] });

    const first = await cancelRun(runId, {
      killOwnedProcessTrees: async () => survivorReport(runId)
    });
    expect(first.terminal).toBe(false);
    expect(first.run.status).toBe("cancelling");
    expect(first.killReport.allDead).toBe(false);

    const persisted = await getRunRepository().get(runId);
    expect(persisted.status).toBe("cancelling");
    // The operation lease is invalidated even though the cancel is not
    // terminal yet: no writer with the old lease may continue.
    expect(persisted.activeOperation).toBeUndefined();
    expect(persisted.mutationFence).toBeGreaterThan(claimed.lease.fencingToken);

    // Retry once the survivor finally died.
    const second = await cancelRun(runId, {
      killOwnedProcessTrees: async () => cleanReport(runId)
    });
    expect(second.terminal).toBe(true);
    expect(second.run.status).toBe("interrupted");
    expect((await getRunRepository().get(runId)).status).toBe("interrupted");
  });

  it("reaches interrupted in one step when the kill report is clean", async () => {
    const runId = "run-cancel-clean";
    await getRunRepository().save(makeRun(runId));

    const outcome = await cancelRun(runId, {
      killOwnedProcessTrees: async () => cleanReport(runId)
    });
    expect(outcome.terminal).toBe(true);
    expect(outcome.run.status).toBe("interrupted");
    expect(outcome.run.interruptedDuring).toBe("running");
  });

  it("records the phase when cancelling a planning run", async () => {
    const runId = "run-cancel-generating";
    await getRunRepository().save(makeRun(runId, "generating"));

    const outcome = await cancelRun(runId, {
      killOwnedProcessTrees: async () => cleanReport(runId)
    });
    expect(outcome.terminal).toBe(true);
    expect(outcome.run.interruptedDuring).toBe("generating");
  });

  it("does not GC worktrees while survivors remain", async () => {
    const runId = "run-cancel-no-gc";
    const run = makeRun(runId);
    run.provisioned = {
      repoRoot: path.join(tempDir, "does-not-matter"),
      baseBranch: "main",
      baseCommit: "abc123",
      provisionedAt: "2026-07-11T00:00:00.000Z"
    };
    await getRunRepository().save(run);

    let gcCalled = false;
    const outcome = await cancelRun(runId, {
      killOwnedProcessTrees: async () => survivorReport(runId),
      gcWorktrees: async () => {
        gcCalled = true;
        return { removed: [], failed: [] };
      }
    });
    expect(outcome.terminal).toBe(false);
    expect(gcCalled).toBe(false);

    const finished = await cancelRun(runId, {
      killOwnedProcessTrees: async () => cleanReport(runId),
      gcWorktrees: async () => {
        gcCalled = true;
        return { removed: [], failed: [] };
      }
    });
    expect(finished.terminal).toBe(true);
    expect(gcCalled).toBe(true);
  });
});
