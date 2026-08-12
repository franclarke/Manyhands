import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonlRunEventStore } from "@manyhands/run-store";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

const at = "2026-08-11T21:50:55.096Z";
let directory: string;
let previousDirectory: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-v2-cache-reconcile-"));
  previousDirectory = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = directory;
  resetRunRepositoryForTests();
});

afterEach(async () => {
  resetRunRepositoryForTests();
  if (previousDirectory === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousDirectory;
  await rm(directory, { recursive: true, force: true });
});

describe("V2 RunRecord cache reconciliation", () => {
  it("repairs a stale running cache from a terminal canonical journal before responding", async () => {
    const runId = "run-stale-terminal-cache";
    const owner = {
      operationId: "11111111-1111-4111-8111-111111111111",
      kind: "execution" as const,
      fencingToken: 1,
      acquiredAt: at,
      heartbeatAt: at
    };
    const events = new JsonlRunEventStore({ directory });
    await events.advanceFence(runId, owner);
    await events.appendFenced(runId, 0, owner, [
      { eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Build recipe server" } },
      { eventId: "proposed", occurredAt: at, type: "graph.revision.proposed", payload: { graphId: "graph", revision: 1 } },
      { eventId: "approved", occurredAt: at, type: "graph.revision.approved", payload: { graphId: "graph", revision: 1 } },
      { eventId: "failed", occurredAt: at, type: "run.failed", payload: { area: "execution", reason: "executor exited" } }
    ]);
    await getRunRepository().save(makeRunRecordV2({
      runId,
      lifecycle: "running",
      projection: { eventSequence: 3, lifecycle: "running", graphId: "graph", graphRevision: 1, approvedGraphRevision: 1, updatedAt: at }
    }));

    const response = await getRun(new Request(`http://localhost/api/runs/${runId}`), {
      params: Promise.resolve({ id: runId })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: { runId, lifecycle: "failed", eventSequence: 4, failureReason: "executor exited" }
    });
    await expect(getRunRepository().get(runId)).resolves.toMatchObject({
      projection: { lifecycle: "failed", eventSequence: 4, failureReason: "executor exited" }
    });
  });
});
