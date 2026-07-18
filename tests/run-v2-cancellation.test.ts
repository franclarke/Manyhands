import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isProcessAlive, registerLiveProcess } from "@manyhands/execution-core";
import { JsonlRunEventStore } from "@manyhands/run-store";
import { POST as POST_CANCEL } from "@/app/api/runs/[id]/cancel/route";
import { RunMutationConflictError } from "@/lib/server/runs/errors";
import { updateRunForOperation } from "@/lib/server/runs/run-operation-lease";
import { resetRunRepositoryForTests, getRunRepository } from "@/lib/server/runs/store";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-cancel-v2-"));
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

describe("V2 cancellation", () => {
  it("invalidates the runner, kills its live process and rejects a late result", async () => {
    const runId = `run-cancel-${Date.now()}`;
    const oldLease = {
      operationId: "11111111-1111-4111-8111-111111111111",
      kind: "execution" as const,
      fencingToken: 1,
      acquiredAt: "2026-07-17T12:00:00.000Z",
      heartbeatAt: "2026-07-17T12:00:00.000Z"
    };
    await getRunRepository().save(makeRunRecordV2({
      runId,
      lifecycle: "running",
      mutationFence: 1,
      activeOperation: oldLease,
      projection: { eventSequence: 3, lifecycle: "running", graphId: "graph-1", graphRevision: 1, approvedGraphRevision: 1, updatedAt: "2026-07-17T12:00:00.000Z" }
    }));
    const store = new JsonlRunEventStore({ directory: process.env.MANYHANDS_RUNS_DIR });
    const authority = { operationId: oldLease.operationId, fencingToken: oldLease.fencingToken };
    await store.advanceFence(runId, authority);
    await store.appendFenced(runId, 0, authority, [
      { eventId: "created", occurredAt: "2026-07-17T12:00:00.000Z", type: "run.created", payload: { goal: "Build it" } },
      { eventId: "proposed", occurredAt: "2026-07-17T12:00:01.000Z", type: "graph.revision.proposed", payload: { graphId: "graph-1", revision: 1 } },
      { eventId: "approved", occurredAt: "2026-07-17T12:00:02.000Z", type: "graph.revision.approved", payload: { graphId: "graph-1", revision: 1 } }
    ]);

    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      stdio: "ignore",
      detached: process.platform !== "win32"
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    registerLiveProcess(runId, child);
    const pid = child.pid!;

    const response = await POST_CANCEL(new Request("http://mh.test", { method: "POST" }), {
      params: Promise.resolve({ id: runId })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      run: { lifecycle: "interrupted" },
      cancellation: { allProcessesDead: true, terminal: true }
    });
    expect(isProcessAlive(pid)).toBe(false);
    expect((await store.load(runId)).slice(-2).map((event) => event.type)).toEqual([
      "operation.cancel_requested",
      "operation.interrupted"
    ]);
    await expect(updateRunForOperation(runId, oldLease, (current) => ({
      ...current,
      projection: { ...current.projection, lifecycle: "result_ready" }
    }))).rejects.toBeInstanceOf(RunMutationConflictError);
  }, 30_000);
});
