import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunMutationConflictError } from "@/lib/server/runs/errors";
import {
  claimRunOperation,
  invalidateRunOperation,
  releaseRunOperation,
  updateRunForOperation
} from "@/lib/server/runs/run-operation-lease";
import type { RunTargetContext } from "@/lib/server/runs/schema";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { captureRunTargetContext } from "@/lib/server/runs/target-context";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

const execFileAsync = promisify(execFile);

let tempDir: string;
let previousRunsDir: string | undefined;
let targetContext: RunTargetContext;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-operation-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
  const repoRoot = path.join(tempDir, "target");
  await mkdir(repoRoot);
  await execFileAsync("git", ["init"], { cwd: repoRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.name", "ManyHands Test"], { cwd: repoRoot, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "manyhands-test@local"], { cwd: repoRoot, windowsHide: true });
  await execFileAsync("git", ["commit", "--allow-empty", "-m", "base"], { cwd: repoRoot, windowsHide: true });
  targetContext = (await captureRunTargetContext(repoRoot))!;
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("V2 run operation leases", () => {
  it("rejects an old runner after takeover claims a higher fencing token", async () => {
    await getRunRepository().save(makeRunRecordV2({ runId: "run-restart", lifecycle: "running", targetContext }));
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
    await getRunRepository().save(makeRunRecordV2({ runId: "run-cancel", lifecycle: "running", targetContext }));
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
    await getRunRepository().save(makeRunRecordV2({ runId: "run-release", lifecycle: "running", targetContext }));
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
    await getRunRepository().save(makeRunRecordV2({ runId: "run-takeover", lifecycle: "running", targetContext }));
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
