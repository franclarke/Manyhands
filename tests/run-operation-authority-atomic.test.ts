import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { makeRunRecordV2 } from "./helpers/run-v2-record";

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
    await expect(events.assertAuthority("run-blocked-takeover", first.lease))
      .rejects.toBeInstanceOf(StaleFencingTokenError);
  });
});
