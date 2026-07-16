import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  JsonPlanMutationJournal,
  PlanMutationConflictError
} from "@/lib/server/runs/plan-mutation-journal";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-plan-mutation-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("PlanMutationOperation journal", () => {
  it("reserves one idempotent operation and rejects a stale record transition", async () => {
    const journal = new JsonPlanMutationJournal({ directory });
    const input = {
      operationId: "replan:run-1:node-a:3",
      runId: "run-1",
      kind: "replan" as const,
      expectedRunVersion: 3,
      sourcePlanRevision: 1,
      targetPlanRevision: 2,
      targetFingerprint: "fingerprint",
      graphHash: "prepared-graph"
    };
    const [left, right] = await Promise.all([journal.reserve(input), journal.reserve(input)]);
    expect(left.operationId).toBe(right.operationId);
    expect(left.version).toBe(0);

    const prepared = await journal.transition(left.operationId, {
      expectedVersion: left.version,
      status: "graph_prepared"
    });
    await expect(
      journal.transition(left.operationId, { expectedVersion: left.version, status: "record_persisted" })
    ).rejects.toBeInstanceOf(PlanMutationConflictError);
    expect(prepared.status).toBe("graph_prepared");
  });

  it("retains an incomplete operation for restart reconciliation and completes it monotonically", async () => {
    const journal = new JsonPlanMutationJournal({ directory });
    const operation = await journal.reserve({
      operationId: "amendment:run-2:seam-a:1",
      runId: "run-2",
      kind: "amendment",
      expectedRunVersion: 1,
      sourcePlanRevision: 4,
      targetPlanRevision: 5,
      targetFingerprint: "fingerprint",
      graphHash: "amended-graph"
    });
    const persisted = await journal.transition(operation.operationId, {
      expectedVersion: operation.version,
      status: "record_persisted"
    });
    const reloaded = new JsonPlanMutationJournal({ directory });
    expect((await reloaded.pending("run-2")).map((entry) => entry.operationId)).toEqual([operation.operationId]);
    const checkpoint = await reloaded.transition(operation.operationId, {
      expectedVersion: persisted.version,
      status: "checkpoint_reset"
    });
    const events = await reloaded.transition(operation.operationId, {
      expectedVersion: checkpoint.version,
      status: "events_persisted"
    });
    const completed = await reloaded.transition(operation.operationId, {
      expectedVersion: events.version,
      status: "completed"
    });
    expect(await reloaded.pending("run-2")).toEqual([]);
    expect(completed.status).toBe("completed");
  });

  it("serializes the shared journal file across independent instances and run ids", async () => {
    const operations = Array.from({ length: 12 }, (_, index) => ({
      operationId: `amendment:run-${index}:seam-a:1`,
      runId: `run-${index}`,
      kind: "amendment" as const,
      expectedRunVersion: index,
      sourcePlanRevision: 1,
      targetPlanRevision: 2,
      graphHash: `graph-${index}`
    }));

    await Promise.all(operations.map((operation) =>
      new JsonPlanMutationJournal({ directory }).reserve(operation)
    ));

    const reloaded = new JsonPlanMutationJournal({ directory });
    const retained = await Promise.all(operations.map((operation) => reloaded.get(operation.operationId)));
    expect(retained.map((operation) => operation?.operationId).sort()).toEqual(
      operations.map((operation) => operation.operationId).sort()
    );
  });
});
