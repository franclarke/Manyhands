import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveRunWithRequiredStatusEvent } from "@/lib/server/runs/audited-mutation";
import { RunMutationConflictError } from "@/lib/server/runs/errors";
import { claimRunMutation } from "@/lib/server/runs/mutation-guard";
import {
  claimRunOperation,
  invalidateRunOperation,
  mutateRunWithLease,
  releaseRunOperation
} from "@/lib/server/runs/run-operation-lease";
import type { RunRecord } from "@/lib/server/runs/schema";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-operation-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("run operation leases", () => {
  it("rejects an old runner after restart claims a higher fencing token", async () => {
    await getRunRepository().save(makeRun("run-restart", "running"));
    const first = await claimRunOperation("run-restart", "execution", {
      expectedStatuses: ["running"]
    });
    const restarted = await claimRunOperation("run-restart", "execution", {
      expectedStatuses: ["running"],
      allowTakeover: true
    });

    expect(restarted.lease.fencingToken).toBeGreaterThan(first.lease.fencingToken);
    await expect(
      mutateRunWithLease("run-restart", first.lease, { status: ["running"] }, (current) => ({
        ...current,
        errorMessage: "stale runner wrote"
      }))
    ).rejects.toBeInstanceOf(RunMutationConflictError);

    const saved = await mutateRunWithLease(
      "run-restart",
      restarted.lease,
      { status: ["running"] },
      (current) => ({ ...current, summary: "new runner owns the run" })
    );
    expect(saved.summary).toBe("new runner owns the run");
    expect(saved.errorMessage).toBeUndefined();
  });

  it("prevents cancel-vs-complete resurrection by invalidating the operation lease", async () => {
    await getRunRepository().save(makeRun("run-cancel", "running"));
    const { lease } = await claimRunOperation("run-cancel", "execution", {
      expectedStatuses: ["running"]
    });
    const snapshotBeforeCancel = await getRunRepository().get("run-cancel");

    await claimRunMutation("run-cancel", { status: ["running"] }, (current) => ({
      ...invalidateRunOperation(current),
      status: "interrupted",
      interruptedDuring: "running",
      errorMessage: "cancelled"
    }));

    await expect(
      saveRunWithRequiredStatusEvent(
        snapshotBeforeCancel,
        { ...snapshotBeforeCancel, status: "completed", completedAt: new Date().toISOString() },
        { lease }
      )
    ).rejects.toBeInstanceOf(RunMutationConflictError);
    expect((await getRunRepository().get("run-cancel")).status).toBe("interrupted");
  });

  it("prevents watchdog-vs-complete from replacing a terminal result", async () => {
    await getRunRepository().save(makeRun("run-watchdog", "running"));
    const { lease } = await claimRunOperation("run-watchdog", "execution", {
      expectedStatuses: ["running"]
    });
    const running = await getRunRepository().get("run-watchdog");
    const completed = await saveRunWithRequiredStatusEvent(
      running,
      { ...running, status: "completed", completedAt: new Date().toISOString() },
      { lease }
    );

    await expect(
      saveRunWithRequiredStatusEvent(
        running,
        {
          ...running,
          status: "interrupted",
          interruptedDuring: "running",
          errorMessage: "stale watchdog"
        },
        { lease }
      )
    ).rejects.toBeInstanceOf(RunMutationConflictError);
    expect((await getRunRepository().get("run-watchdog")).version).toBe(completed.version);
    expect((await getRunRepository().get("run-watchdog")).status).toBe("completed");
  });

  it("release is fenced and cannot clear a newer owner's lease", async () => {
    await getRunRepository().save(makeRun("run-release", "running"));
    const first = await claimRunOperation("run-release", "execution", {
      expectedStatuses: ["running"]
    });
    const second = await claimRunOperation("run-release", "execution", {
      expectedStatuses: ["running"],
      allowTakeover: true
    });

    await releaseRunOperation("run-release", first.lease);
    expect((await getRunRepository().get("run-release")).activeOperation).toEqual(second.lease);
    await releaseRunOperation("run-release", second.lease);
    expect((await getRunRepository().get("run-release")).activeOperation).toBeUndefined();
  });

  it("never revalidates an old lease when a stale snapshot is restored", async () => {
    await getRunRepository().save(makeRun("run-fence-monotonic", "running"));
    const claimed = await claimRunOperation("run-fence-monotonic", "execution", {
      expectedStatuses: ["running"]
    });
    await claimRunMutation("run-fence-monotonic", { status: ["running"] }, (current) =>
      invalidateRunOperation(current)
    );

    const restored = await getRunRepository().save(claimed.run);
    expect(restored.mutationFence).toBeGreaterThan(claimed.lease.fencingToken);
    await expect(
      mutateRunWithLease("run-fence-monotonic", claimed.lease, {}, (current) => current)
    ).rejects.toBeInstanceOf(RunMutationConflictError);
  });
});

function makeRun(runId: string, status: RunRecord["status"]): RunRecord {
  const now = new Date().toISOString();
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "sonnet",
    userPrompt: "Implement feature",
    title: "Implement feature",
    version: 0,
    status,
    createdAt: now,
    updatedAt: now,
    patches: []
  };
}
