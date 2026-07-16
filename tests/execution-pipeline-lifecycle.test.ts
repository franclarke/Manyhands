import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  finalizeExecutionPipelineOwnership,
  settleAbortedExecutionCancellation
} from "@/lib/server/runs/execution-pipeline";
import {
  isRunnerActive,
  markRunnerActive,
  markRunnerInactive,
  tryMarkRunnerActive
} from "@/lib/server/runs/runner-state";
import {
  acquireRepoLock,
  releaseRepoLease,
  startRepoLeaseHeartbeat
} from "@/lib/server/runs/repo-lock";
import type { RunOperationLease, RunRecord } from "@/lib/server/runs/schema";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const activeRunIds = new Set<string>();
const tempDirs = new Set<string>();

afterEach(async () => {
  for (const runId of activeRunIds) markRunnerInactive(runId);
  activeRunIds.clear();
  for (const directory of tempDirs) await rm(directory, { recursive: true, force: true });
  tempDirs.clear();
});

describe("execution pipeline lifecycle ownership", () => {
  it("waits for an aborted cancellation to leave cancelling before cleanup can continue", async () => {
    let status: RunRecord["status"] = "cancelling";
    const sleepEntered = deferred();
    const releaseSleep = deferred();
    let settled = false;

    const waiting = settleAbortedExecutionCancellation("run-cancel", {
      readStatus: async () => status,
      sleep: async () => {
        sleepEntered.resolve();
        await releaseSleep.promise;
      }
    }).then(() => {
      settled = true;
    });

    await sleepEntered.promise;
    expect(settled).toBe(false);

    status = "interrupted";
    releaseSleep.resolve();
    await waiting;
    expect(settled).toBe(true);
  });

  it("keeps retrying verified cancellation after the former 30-second timeout", async () => {
    let status: RunRecord["status"] = "cancelling";
    let elapsedMs = 0;
    let recoveryAttempts = 0;

    await settleAbortedExecutionCancellation("run-long-survivor", {
      readStatus: async () => status,
      recoverCancellation: async () => {
        recoveryAttempts += 1;
        if (recoveryAttempts === 3) status = "interrupted";
      },
      retryDelayMs: 15_500,
      sleep: async (ms) => {
        elapsedMs += ms;
      }
    });

    expect(recoveryAttempts).toBe(3);
    expect(elapsedMs).toBe(46_500);
    expect(status).toBe("interrupted");
  });

  it("retries a transient durable lease release and leaves no terminal owner", async () => {
    const runId = "run-release-io-failure";
    activeRunIds.add(runId);
    markRunnerActive(runId);
    const lease: RunOperationLease = {
      operationId: "00000000-0000-4000-8000-000000000099",
      kind: "execution",
      fencingToken: 9,
      acquiredAt: "2026-07-16T12:00:00.000Z",
      heartbeatAt: "2026-07-16T12:00:00.000Z"
    };
    let durableOwner = true;
    const releaseOperation = vi.fn(async () => {
      if (releaseOperation.mock.calls.length === 1) {
        throw new Error("simulated transient lease release I/O failure");
      }
      durableOwner = false;
    });

    await expect(finalizeExecutionPipelineOwnership({
      runId,
      budgetWatchdog: undefined,
      stopRepoHeartbeat: undefined,
      repoLease: undefined,
      stopHeartbeat: undefined,
      lease
    }, { releaseOperation, sleep: async () => undefined })).resolves.toBeUndefined();

    expect(isRunnerActive(runId)).toBe(false);
    expect(durableOwner).toBe(false);
    expect(tryMarkRunnerActive(runId)).toBe(true);
    markRunnerInactive(runId);
    expect(releaseOperation).toHaveBeenCalledTimes(2);
  });

  it("surfaces exhausted release retries, clears the local owner and permits explicit recovery", async () => {
    const runId = "run-release-exhausted";
    activeRunIds.add(runId);
    markRunnerActive(runId);
    const lease: RunOperationLease = {
      operationId: "00000000-0000-4000-8000-000000000098",
      kind: "execution",
      fencingToken: 8,
      acquiredAt: "2026-07-16T12:00:00.000Z",
      heartbeatAt: "2026-07-16T12:00:00.000Z"
    };
    let durableOwner = true;
    const failure = new Error("persistent storage outage");
    const exhaustedRelease = vi.fn(async () => {
      throw failure;
    });

    await expect(finalizeExecutionPipelineOwnership({
      runId,
      budgetWatchdog: undefined,
      stopRepoHeartbeat: undefined,
      repoLease: undefined,
      stopHeartbeat: undefined,
      lease
    }, {
      releaseOperation: exhaustedRelease,
      releaseRetryDelaysMs: [0, 0],
      sleep: async () => undefined
    })).rejects.toBe(failure);

    expect(exhaustedRelease).toHaveBeenCalledTimes(3);
    expect(isRunnerActive(runId)).toBe(false);
    expect(durableOwner).toBe(true);

    const recoveredRelease = vi.fn(async () => {
      durableOwner = false;
    });
    await finalizeExecutionPipelineOwnership({
      runId,
      budgetWatchdog: undefined,
      stopRepoHeartbeat: undefined,
      repoLease: undefined,
      stopHeartbeat: undefined,
      lease
    }, { releaseOperation: recoveredRelease });
    expect(durableOwner).toBe(false);
    expect(recoveredRelease).toHaveBeenCalledOnce();
  });

  it("retains the repository lease beyond the old 30s ceiling until allDead recovery settles", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mh-cancel-repo-owner-"));
    tempDirs.add(directory);
    const runId = "run-survivor-repo-owner";
    activeRunIds.add(runId);
    markRunnerActive(runId);
    const first = await acquireRepoLock(directory, runId, {
      resolveLockBase: async () => directory
    });
    expect(first.acquired).toBe(true);
    if (!first.acquired) throw new Error("expected initial repository lease");
    const stopRepoHeartbeat = startRepoLeaseHeartbeat(first.lease, { intervalMs: 5 });
    const cancellationSettled = deferred();
    let releaseFinished = false;

    const finalizing = finalizeExecutionPipelineOwnership({
      runId,
      budgetWatchdog: undefined,
      stopRepoHeartbeat,
      repoLease: first.lease,
      stopHeartbeat: undefined,
      lease: undefined
    }, {
      settleCancellation: async () => cancellationSettled.promise
    }).then(() => {
      releaseFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    const blocked = await acquireRepoLock(directory, "run-contender", {
      resolveLockBase: async () => directory,
      // Simulates observation after the former 30-second settlement timeout;
      // the actively renewed token remains authoritative.
      staleMs: 1
    });
    expect(blocked.acquired).toBe(false);
    expect(releaseFinished).toBe(false);

    cancellationSettled.resolve();
    await finalizing;
    const acquiredAfterAllDead = await acquireRepoLock(directory, "run-contender", {
      resolveLockBase: async () => directory
    });
    expect(acquiredAfterAllDead.acquired).toBe(true);
    if (acquiredAfterAllDead.acquired) await releaseRepoLease(acquiredAfterAllDead.lease);
  });
});
