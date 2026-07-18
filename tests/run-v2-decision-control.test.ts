import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonlRunEventStore } from "@manyhands/run-store";
import { resolveDecisionV2 } from "@/lib/server/runs/v2/command-host";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

const at = "2026-07-18T12:00:00.000Z";
let directory: string;
let previousDirectory: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mh-decision-v2-"));
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

describe("V2 local decision control", () => {
  it("resolves a node decision under the live execution authority without fencing independent siblings", async () => {
    const runId = "run-decision-live";
    const lease = {
      operationId: "77777777-7777-4777-8777-777777777777",
      kind: "execution" as const,
      fencingToken: 5,
      acquiredAt: at,
      heartbeatAt: at
    };
    const store = new JsonlRunEventStore({ directory });
    await store.advanceFence(runId, lease);
    await store.appendFenced(runId, 0, lease, [
      { eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Build booking" } },
      { eventId: "proposed", occurredAt: at, type: "graph.revision.proposed", payload: { graphId: "graph", revision: 1 } },
      { eventId: "approved", occurredAt: at, type: "graph.revision.approved", payload: { graphId: "graph", revision: 1 } },
      {
        eventId: "decision",
        occurredAt: at,
        type: "decision.raised",
        payload: {
          decision: {
            id: "decision-api",
            kind: "resolve_conflict",
            question: "Which API response should the booking form consume?",
            options: [{ id: "retry", label: "Use the declared response" }, { id: "stop", label: "Stop" }],
            affectedNodeIds: ["node-api"],
            evidenceRefs: ["attempt-api"],
            impact: "behavior"
          }
        }
      }
    ]);
    await getRunRepository().save(makeRunRecordV2({
      runId,
      lifecycle: "running",
      mutationFence: lease.fencingToken,
      activeOperation: lease,
      projection: { eventSequence: 4, lifecycle: "running", graphId: "graph", graphRevision: 1, approvedGraphRevision: 1, updatedAt: at }
    }));

    const resolved = await resolveDecisionV2(runId, "decision-api", { optionId: "retry" });

    expect(resolved.state.decisions["decision-api"]).toMatchObject({ status: "resolved", resolution: { optionId: "retry" } });
    expect(resolved.run.activeOperation).toMatchObject({ operationId: lease.operationId, fencingToken: lease.fencingToken, kind: "execution" });
    expect((await store.load(runId)).at(-1)?.type).toBe("decision.resolved");
  });
});
