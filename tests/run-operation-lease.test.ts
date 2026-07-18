import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunMutationConflictError } from "@/lib/server/runs/errors";
import {
  claimRunOperation,
  invalidateRunOperation,
  releaseRunOperation,
  updateRunForOperation
} from "@/lib/server/runs/run-operation-lease";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

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

describe("V2 run operation leases", () => {
  it("rejects an old runner after takeover claims a higher fencing token", async () => {
    await getRunRepository().save(makeRunRecordV2({ runId: "run-restart", lifecycle: "running" }));
    const first = await claimRunOperation("run-restart", "execution", { expectedLifecycles: ["running"] });
    const restarted = await claimRunOperation("run-restart", "execution", {
      expectedLifecycles: ["running"],
      allowTakeover: true
    });

    expect(restarted.lease.fencingToken).toBeGreaterThan(first.lease.fencingToken);
    await expect(
      updateRunForOperation("run-restart", first.lease, (current) => ({ ...current, title: "stale" }))
    ).rejects.toBeInstanceOf(RunMutationConflictError);
    const saved = await updateRunForOperation("run-restart", restarted.lease, (current) => ({
      ...current,
      title: "current owner"
    }));
    expect(saved.title).toBe("current owner");
  });

  it("invalidating authority rejects a late completion writer", async () => {
    await getRunRepository().save(makeRunRecordV2({ runId: "run-cancel", lifecycle: "running" }));
    const { lease } = await claimRunOperation("run-cancel", "execution", { expectedLifecycles: ["running"] });
    await getRunRepository().update("run-cancel", invalidateRunOperation);

    await expect(
      updateRunForOperation("run-cancel", lease, (current) => ({
        ...current,
        projection: { ...current.projection, lifecycle: "result_ready" }
      }))
    ).rejects.toBeInstanceOf(RunMutationConflictError);
    expect((await getRunRepository().get("run-cancel")).projection.lifecycle).toBe("running");
  });

  it("a fenced release cannot clear the newer owner's lease", async () => {
    await getRunRepository().save(makeRunRecordV2({ runId: "run-release", lifecycle: "running" }));
    const first = await claimRunOperation("run-release", "execution", { expectedLifecycles: ["running"] });
    const second = await claimRunOperation("run-release", "execution", {
      expectedLifecycles: ["running"],
      allowTakeover: true
    });

    await releaseRunOperation("run-release", first.lease);
    expect((await getRunRepository().get("run-release")).activeOperation).toEqual(second.lease);
    await releaseRunOperation("run-release", second.lease);
    expect((await getRunRepository().get("run-release")).activeOperation).toBeUndefined();
  });

  it("permits stale takeover but rejects takeover with a fresh heartbeat", async () => {
    await getRunRepository().save(makeRunRecordV2({ runId: "run-takeover", lifecycle: "running" }));
    const first = await claimRunOperation("run-takeover", "execution", {
      expectedLifecycles: ["running"],
      now: "2026-07-17T12:00:00.000Z"
    });
    await expect(claimRunOperation("run-takeover", "execution", {
      expectedLifecycles: ["running"],
      allowTakeover: true,
      takeoverStaleAfterMs: 600_000,
      now: "2026-07-17T12:01:00.000Z"
    })).rejects.toBeInstanceOf(RunMutationConflictError);

    const recovered = await claimRunOperation("run-takeover", "execution", {
      expectedLifecycles: ["running"],
      allowTakeover: true,
      takeoverStaleAfterMs: 600_000,
      now: "2026-07-17T12:11:00.000Z"
    });
    expect(recovered.lease.fencingToken).toBeGreaterThan(first.lease.fencingToken);
  });
});
