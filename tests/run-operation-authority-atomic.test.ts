import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isProcessAlive, registerLiveProcess } from "@manyhands/execution-core";
import { JsonlRunEventStore, StaleFencingTokenError } from "@manyhands/run-store";
import {
  RunOperationAuthority,
  type RunOperationAuthorityDependencies
} from "@/lib/server/runs/run-operation-lease";
import {
  JsonRunRecordStore,
  type RunRepository
} from "@/lib/server/runs/repository";
import { withRepositoryLease } from "@/lib/server/runs/repo-lock";
import { captureRunTargetContext } from "@/lib/server/runs/target-context";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

const execFileAsync = promisify(execFile);

let tempDir: string;
let runsDirectory: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-authority-"));
  runsDirectory = path.join(tempDir, "runs");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function authority(
  repository: RunRepository,
  events: JsonlRunEventStore,
  overrides: Partial<RunOperationAuthorityDependencies> = {}
): RunOperationAuthority {
  return new RunOperationAuthority({
    repository,
    events,
    reconcileRepository: async () => true,
    ...overrides
  });
}

describe("atomic run authority", () => {
  it("fences the previous owner even if the process crashes before publishing the new claim", async () => {
    const repository = new JsonRunRecordStore({ directory: runsDirectory });
    const events = new JsonlRunEventStore({ directory: runsDirectory });
    await repository.save(makeRunRecordV2({ runId: "run-crash-window", lifecycle: "running" }));
    const first = await authority(repository, events, {
      operationId: () => "11111111-1111-4111-8111-111111111111"
    }).claim("run-crash-window", "execution", {
      expectedLifecycles: ["running"],
      now: "2026-07-29T12:00:00.000Z"
    });
    await events.appendFenced("run-crash-window", 0, first.lease, [{
      eventId: "created",
      occurredAt: "2026-07-29T12:00:00.000Z",
      type: "run.created",
      payload: { goal: "Prove atomic authority" }
    }]);

    const crashRepository: RunRepository = {
      list: (filter) => repository.list(filter),
      listStrict: (filter) => repository.listStrict(filter),
      get: (runId) => repository.get(runId),
      save: (run) => repository.save(run),
      update: async (runId, mutate) => {
        await mutate(await repository.get(runId));
        throw new Error("simulated crash before RunRecord publication");
      },
      delete: (runId) => repository.delete(runId)
    };
    const crashing = authority(crashRepository, events, {
      operationId: () => "22222222-2222-4222-8222-222222222222",
      reconcileTakeover: async () => ({
        processReceiptId: "takeover-processes-crash",
        allDead: true,
        processCount: 0
      })
    });

    await expect(crashing.claim("run-crash-window", "execution", {
      expectedLifecycles: ["running"],
      allowTakeover: true,
      takeoverStaleAfterMs: 1,
      now: "2026-07-29T12:01:00.000Z"
    })).rejects.toThrow("simulated crash");

    await expect(events.appendFenced("run-crash-window", 1, first.lease, [{
      eventId: "late-failure",
      occurredAt: "2026-07-29T12:01:01.000Z",
      type: "run.failed",
      payload: { reason: "late stale result", area: "execution" }
    }])).rejects.toBeInstanceOf(StaleFencingTokenError);
    expect((await repository.get("run-crash-window")).activeOperation).toEqual(first.lease);

    const recovered = await authority(repository, events, {
      operationId: () => "55555555-5555-4555-8555-555555555555",
      reconcileTakeover: async () => ({
        processReceiptId: "takeover-processes-recovered",
        allDead: true,
        processCount: 0
      })
    }).claim("run-crash-window", "execution", {
      expectedLifecycles: ["running"],
      allowTakeover: true,
      takeoverStaleAfterMs: 1,
      now: "2026-07-29T12:02:00.000Z"
    });
    expect(recovered.lease.fencingToken).toBeGreaterThan(first.lease.fencingToken + 1);
  });

  it("kills and verifies a live child before returning a takeover claim for dispatch", async () => {
    const repository = new JsonRunRecordStore({ directory: runsDirectory });
    const events = new JsonlRunEventStore({ directory: runsDirectory });
    await repository.save(makeRunRecordV2({ runId: "run-live-takeover", lifecycle: "running" }));
    const ids = [
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444"
    ];
    const manager = authority(repository, events, {
      operationId: () => ids.shift()!
    });
    const first = await manager.claim("run-live-takeover", "execution", {
      expectedLifecycles: ["running"],
      now: "2026-07-29T12:00:00.000Z"
    });
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      stdio: "ignore",
      detached: process.platform !== "win32"
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    registerLiveProcess("run-live-takeover", child, {
      runId: "run-live-takeover",
      operationId: first.lease.operationId,
      label: "old-owner-child"
    });
    const pid = child.pid!;

    try {
      const taken = await manager.claim("run-live-takeover", "execution", {
        expectedLifecycles: ["running"],
        allowTakeover: true,
        takeoverStaleAfterMs: 1,
        now: "2026-07-29T12:01:00.000Z"
      });
      const receipt = taken.run.lastTakeoverReceipt;
      expect(receipt).toMatchObject({
        supersededOperationId: first.lease.operationId,
        operationId: taken.lease.operationId,
        allDead: true
      });
      expect(receipt?.processCount).toBeGreaterThanOrEqual(1);
      expect(isProcessAlive(pid)).toBe(false);

      // A caller can dispatch only after claim() returned its durable allDead receipt.
      const dispatchOrder = [receipt?.allDead === true ? "allDead" : "unverified", "dispatch"];
      expect(dispatchOrder).toEqual(["allDead", "dispatch"]);
    } finally {
      if (isProcessAlive(pid)) child.kill();
    }
  }, 30_000);

  it("does not publish or return a takeover when process reconciliation cannot prove allDead", async () => {
    const repository = new JsonRunRecordStore({ directory: runsDirectory });
    const events = new JsonlRunEventStore({ directory: runsDirectory });
    await repository.save(makeRunRecordV2({ runId: "run-blocked-takeover", lifecycle: "running" }));
    const first = await authority(repository, events, {
      operationId: () => "66666666-6666-4666-8666-666666666666"
    }).claim("run-blocked-takeover", "execution", {
      expectedLifecycles: ["running"],
      now: "2026-07-29T12:00:00.000Z"
    });

    await expect(authority(repository, events, {
      operationId: () => "77777777-7777-4777-8777-777777777777",
      reconcileTakeover: async () => ({
        processReceiptId: "takeover-processes-unverified",
        allDead: false,
        processCount: 1
      })
    }).claim("run-blocked-takeover", "execution", {
      expectedLifecycles: ["running"],
      allowTakeover: true,
      takeoverStaleAfterMs: 1,
      now: "2026-07-29T12:01:00.000Z"
    })).rejects.toThrow("did not verify allDead");

    expect((await repository.get("run-blocked-takeover")).activeOperation).toEqual(first.lease);
    // A failed takeover must not fence the owner that is still responsible
    // for quiescing the run.
    await expect(events.assertAuthority("run-blocked-takeover", first.lease))
      .resolves.toBeUndefined();
  });

  it("timestamps the takeover receipt and published heartbeat after process verification", async () => {
    const repository = new JsonRunRecordStore({ directory: runsDirectory });
    const events = new JsonlRunEventStore({ directory: runsDirectory });
    await repository.save(makeRunRecordV2({ runId: "run-takeover-time", lifecycle: "running" }));
    const first = await authority(repository, events, {
      operationId: () => "88888888-8888-4888-8888-888888888888"
    }).claim("run-takeover-time", "execution", {
      expectedLifecycles: ["running"],
      now: "2026-07-29T12:00:00.000Z"
    });
    let verificationCompletedAt = 0;

    const taken = await authority(repository, events, {
      operationId: () => "99999999-9999-4999-8999-999999999999",
      reconcileTakeover: async () => {
        verificationCompletedAt = Date.now();
        return {
          processReceiptId: "takeover-processes-timed",
          allDead: true,
          processCount: 0
        };
      }
    }).claim("run-takeover-time", "execution", {
      expectedLifecycles: ["running"],
      allowTakeover: true,
      takeoverStaleAfterMs: 1,
      now: "2026-07-29T12:01:00.000Z"
    });

    expect(first.lease.heartbeatAt).toBe("2026-07-29T12:00:00.000Z");
    expect(Date.parse(taken.run.lastTakeoverReceipt!.verifiedAt)).toBeGreaterThanOrEqual(
      verificationCompletedAt
    );
    expect(Date.parse(taken.lease.heartbeatAt)).toBeGreaterThanOrEqual(verificationCompletedAt);
    expect(taken.run.heartbeatAt).toBe(taken.lease.heartbeatAt);
  });

  it("does not publish takeover authority until repository effects are quiescent", async () => {
    const repository = new JsonRunRecordStore({ directory: runsDirectory });
    const events = new JsonlRunEventStore({ directory: runsDirectory });
    await repository.save(makeRunRecordV2({ runId: "run-repository-barrier", lifecycle: "running" }));
    const first = await authority(repository, events, {
      operationId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }).claim("run-repository-barrier", "delivery", {
      expectedLifecycles: ["running"],
      now: "2026-07-29T12:00:00.000Z"
    });
    let processReconciled!: () => void;
    const processesDone = new Promise<void>((resolve) => {
      processReconciled = resolve;
    });
    let releaseRepository!: () => void;
    const repositoryCanQuiesce = new Promise<void>((resolve) => {
      releaseRepository = resolve;
    });
    let claimSettled = false;

    const takeover = authority(repository, events, {
      operationId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      reconcileTakeover: async () => {
        processReconciled();
        return {
          processReceiptId: "takeover-processes-repository-barrier",
          allDead: true,
          processCount: 0
        };
      },
      reconcileRepository: async () => {
        await repositoryCanQuiesce;
        return true;
      }
    }).claim("run-repository-barrier", "delivery", {
      expectedLifecycles: ["running"],
      allowTakeover: true,
      takeoverStaleAfterMs: 1,
      now: "2026-07-29T12:01:00.000Z"
    }).finally(() => {
      claimSettled = true;
    });

    await processesDone;
    await Promise.resolve();
    const settledBeforeRepositoryBarrier = claimSettled;
    releaseRepository();
    const taken = await takeover;

    expect(settledBeforeRepositoryBarrier).toBe(false);
    expect(taken.run.lastTakeoverReceipt).toMatchObject({
      allDead: true,
      repositoryQuiescent: true
    });
    await expect(events.assertAuthority("run-repository-barrier", first.lease))
      .rejects.toBeInstanceOf(StaleFencingTokenError);
  });

  it("leaves the previous authority intact when takeover quiescence fails", async () => {
    const repository = new JsonRunRecordStore({ directory: runsDirectory });
    const events = new JsonlRunEventStore({ directory: runsDirectory });
    await repository.save(makeRunRecordV2({ runId: "run-repository-barrier-failed", lifecycle: "running" }));
    const first = await authority(repository, events, {
      operationId: () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    }).claim("run-repository-barrier-failed", "execution", {
      expectedLifecycles: ["running"],
      now: "2026-07-29T12:00:00.000Z"
    });

    const takeover = authority(repository, events, {
      operationId: () => "ffffffff-ffff-4fff-8fff-ffffffffffff",
      reconcileTakeover: async () => ({
        processReceiptId: "takeover-processes-failed-barrier",
        allDead: true,
        processCount: 0
      }),
      reconcileRepository: async () => false
    });

    await expect(takeover.claim("run-repository-barrier-failed", "execution", {
      expectedLifecycles: ["running"],
      allowTakeover: true,
      takeoverStaleAfterMs: 1,
      now: "2026-07-29T12:01:00.000Z"
    })).rejects.toThrow(/repository effects/i);

    await expect(events.assertAuthority("run-repository-barrier-failed", first.lease)).resolves.toBeUndefined();
  });

  it.each(["planning", "delivery"] as const)(
    "crosses the durable repository lease before publishing a cross-host %s takeover",
    async (kind) => {
      const repoRoot = path.join(tempDir, "target");
      await mkdir(repoRoot);
      await execFileAsync("git", ["init"], { cwd: repoRoot, windowsHide: true });
      await execFileAsync("git", ["config", "user.name", "ManyHands Test"], { cwd: repoRoot, windowsHide: true });
      await execFileAsync("git", ["config", "user.email", "manyhands-test@local"], { cwd: repoRoot, windowsHide: true });
      await execFileAsync("git", ["commit", "--allow-empty", "-m", "base"], { cwd: repoRoot, windowsHide: true });
      const targetContext = await captureRunTargetContext(repoRoot);
      expect(targetContext).toBeDefined();

      const repository = new JsonRunRecordStore({ directory: runsDirectory });
      const events = new JsonlRunEventStore({ directory: runsDirectory });
      const runId = "run-cross-host-barrier";
      await repository.save(makeRunRecordV2({
        runId,
        lifecycle: "running",
        targetContext: targetContext!
      }));
      const first = await authority(repository, events, {
        operationId: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      }).claim(runId, kind, {
        expectedLifecycles: ["running"],
        now: "2026-07-29T12:00:00.000Z"
      });
      let repositoryHeld!: () => void;
      const held = new Promise<void>((resolve) => {
        repositoryHeld = resolve;
      });
      let releaseRepository!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseRepository = resolve;
      });
      const oldHostEffect = withRepositoryLease({ repoRoot, runId }, async () => {
        repositoryHeld();
        await release;
      });
      await held;

      let takeoverSettled = false;
      const takeover = new RunOperationAuthority({
        repository,
        events,
        operationId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        reconcileTakeover: async () => ({
          processReceiptId: "takeover-processes-cross-host",
          allDead: true,
          processCount: 0
        })
      }).claim(runId, kind, {
        expectedLifecycles: ["running"],
        allowTakeover: true,
        takeoverStaleAfterMs: 1,
        now: "2026-07-29T12:01:00.000Z"
      }).finally(() => {
        takeoverSettled = true;
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      const settledWhileOldHostHeldLease = takeoverSettled;
      releaseRepository();
      await oldHostEffect;
      const taken = await takeover;

      expect(settledWhileOldHostHeldLease).toBe(false);
      expect(taken.run.lastTakeoverReceipt?.repositoryQuiescent).toBe(true);
      await expect(events.assertAuthority(runId, first.lease))
        .rejects.toBeInstanceOf(StaleFencingTokenError);
    }
  );
});
